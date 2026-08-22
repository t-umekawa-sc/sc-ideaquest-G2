"""会社DB クエスト・カテゴリ・パーティー・権限の永続化プリミティブ（API設計 C.1〜C.5・§5.6〜§5.9）。

方針（quest_group.repository と同じ）:
- いずれも呼び出し側の Tx に相乗（自身では commit しない）＝application が UoW 境界を持つ。
- 論理削除はトゥームストーン（quests=`deleted_at`／quest_members=`removed_at`）。有効行のみを返す関数は
  `deleted_at IS NULL` / `removed_at IS NULL` で絞る。
- パーティー再追加は既存トゥームストーン行を**再利用**（`removed_at` を NULL・`joined_at=now()`・既定権限再付与）。
- 一覧はキーセット（カーソル）ページング（§1.8）。ソートタプル `(created_at, id)` DESC を既定にする。

認可（候補制限・owner 付与制限・作成者保護・状態機械）は application 層で強制する（C.0/C.3/C.5）。
本 repository は永続化の原子操作のみを提供する。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests.orm import Quest, QuestCategory, QuestMember, QuestMemberPermission

# 新規参加メンバーの既定権限（サーバー自動付与・§5.9/C.3）。
DEFAULT_MEMBER_PERMISSIONS: tuple[str, ...] = ("vote", "idea_create", "comment")


# ---- クエスト本体（C.1/C.2） ----

def create_quest(
    session: Session,
    *,
    quest_group_id: uuid.UUID,
    owner_id: uuid.UUID,
    title: str,
    color: str,
    status: str,
    purpose: str | None = None,
    deadline=None,
    icon_image_path: str | None = None,
    quest_id: uuid.UUID | None = None,
) -> Quest:
    """クエストを1件作成（カテゴリ/パーティーは別プリミティブ）。作成者を owner_id に保存。"""
    quest = Quest(
        id=quest_id or uuid.uuid4(),
        quest_group_id=quest_group_id,
        owner_id=owner_id,
        title=title,
        color=color,
        status=status,
        purpose=purpose,
        deadline=deadline,
        icon_image_path=icon_image_path,
    )
    session.add(quest)
    return quest


def get_quest(session: Session, quest_id: uuid.UUID) -> Quest | None:
    """有効なクエスト（`deleted_at IS NULL`）を1件取得。削除済み/不在は None。"""
    return session.execute(
        select(Quest).where(Quest.id == quest_id, Quest.deleted_at.is_(None))
    ).scalars().first()


def list_quests_for_user(
    session: Session,
    *,
    user_id: uuid.UUID,
    visible_group_ids: list[uuid.UUID],
    q: str | None = None,
    status: list[str] | None = None,
    group_id: uuid.UUID | None = None,
    cursor: tuple[datetime, uuid.UUID] | None = None,
    limit: int = 20,
) -> list[Quest]:
    """参照制限（C.1・FR-15）を満たすクエストを新着順（created_at, id DESC）で取得。

    (A) 公開系＝`status != 'draft'` かつ **所属グループ内**（`quest_group_id IN visible_group_ids`）
        かつ **自分がパーティー参加中**（当該クエストに `quest_members.removed_at IS NULL` の自分の行あり）。
        グループ門番とパーティー門番の**両方**（C.0）を満たす行のみ返す。
    (B) 自分の下書き＝`owner_id = user_id` かつ `status = 'draft'`（パーティー門番の対象外＝本人だけに見える）。
    どちらも `deleted_at IS NULL`。ソート系は §1.8.1 の複数指定に後で対応（本スライスは新着順のみ）。
    """
    from sqlalchemy import and_, exists, or_

    is_party_member = exists().where(
        QuestMember.quest_id == Quest.id,
        QuestMember.user_id == user_id,
        QuestMember.removed_at.is_(None),
    )
    public_cond = and_(
        Quest.status != "draft",
        Quest.quest_group_id.in_(visible_group_ids or []),
        is_party_member,
    )
    draft_cond = and_(Quest.status == "draft", Quest.owner_id == user_id)
    stmt = select(Quest).where(Quest.deleted_at.is_(None), or_(public_cond, draft_cond))

    if q:
        # 簡易絞り＝件名/目的の部分一致（横断全文検索は §1.11 PGroonga に委譲・C.1）。カテゴリ一致は後続。
        like = f"%{q}%"
        stmt = stmt.where(or_(Quest.title.ilike(like), Quest.purpose.ilike(like)))
    if status:
        stmt = stmt.where(Quest.status.in_(status))
    if group_id is not None:
        stmt = stmt.where(Quest.quest_group_id == group_id)
    if cursor is not None:
        stmt = stmt.where(tuple_(Quest.created_at, Quest.id) < tuple_(cursor[0], cursor[1]))

    stmt = stmt.order_by(Quest.created_at.desc(), Quest.id.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


# ---- カテゴリ（C.2・§5.7） ----

def list_categories(session: Session, quest_id: uuid.UUID) -> list[QuestCategory]:
    return list(
        session.execute(
            select(QuestCategory).where(QuestCategory.quest_id == quest_id).order_by(QuestCategory.label)
        ).scalars().all()
    )


def replace_categories(
    session: Session, quest_id: uuid.UUID, entries: list[tuple[str, bool]]
) -> None:
    """カテゴリを置換セットで全置換（§5.7）。`entries`＝正規化済み (label, is_custom) の列。

    application 側でトリム＋大小文字/全半角正規化・重複排除済みの前提。
    """
    for row in session.execute(
        select(QuestCategory).where(QuestCategory.quest_id == quest_id)
    ).scalars().all():
        session.delete(row)
    session.flush()
    for label, is_custom in entries:
        session.add(QuestCategory(id=uuid.uuid4(), quest_id=quest_id, label=label, is_custom=is_custom))


# ---- パーティー・権限（C.3・§5.8/§5.9） ----

def get_active_member(session: Session, quest_id: uuid.UUID, user_id: uuid.UUID) -> QuestMember | None:
    """有効なパーティー参加（`removed_at IS NULL`）を返す。無ければ None（部分ユニークで高々1件）。"""
    return session.execute(
        select(QuestMember).where(
            QuestMember.quest_id == quest_id,
            QuestMember.user_id == user_id,
            QuestMember.removed_at.is_(None),
        )
    ).scalars().first()


def add_member(
    session: Session,
    quest_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    permissions: list[str] | None = None,
    granted_by_id: uuid.UUID | None = None,
) -> QuestMember:
    """メンバーを追加（既定権限は vote+idea_create+comment）。

    再追加＝既存トゥームストーン行を再利用（`removed_at`→NULL・`joined_at=now()`・権限を張り直し・§5.8）。
    有効行が既にあれば権限のみ置換する。
    """
    perms = list(permissions) if permissions is not None else list(DEFAULT_MEMBER_PERMISSIONS)
    active = get_active_member(session, quest_id, user_id)
    if active is not None:
        _replace_permissions(session, active, perms, granted_by_id)
        return active
    tombstoned = session.execute(
        select(QuestMember)
        .where(
            QuestMember.quest_id == quest_id,
            QuestMember.user_id == user_id,
            QuestMember.removed_at.is_not(None),
        )
        .order_by(QuestMember.removed_at.desc())
    ).scalars().first()
    if tombstoned is not None:
        tombstoned.removed_at = None
        tombstoned.joined_at = datetime.now(timezone.utc)
        _replace_permissions(session, tombstoned, perms, granted_by_id)
        return tombstoned
    member = QuestMember(id=uuid.uuid4(), quest_id=quest_id, user_id=user_id)
    session.add(member)
    session.flush()  # id 確定＝権限行の FK に使う
    _replace_permissions(session, member, perms, granted_by_id)
    return member


def remove_member(session: Session, quest_id: uuid.UUID, user_id: uuid.UUID) -> QuestMember | None:
    """パーティーから外す（`removed_at` 設定＝論理削除）＋権限行を削除して権限を失う（§5.8）。

    アイデア/投票/評価/コメントは削除しない（表示継続）。有効参加が無ければ no-op で None（冪等）。
    """
    active = get_active_member(session, quest_id, user_id)
    if active is None:
        return None
    active.removed_at = datetime.now(timezone.utc)
    for perm in session.execute(
        select(QuestMemberPermission).where(QuestMemberPermission.quest_member_id == active.id)
    ).scalars().all():
        session.delete(perm)
    return active


def set_member_permissions(
    session: Session,
    quest_id: uuid.UUID,
    user_id: uuid.UUID,
    permissions: list[str],
    *,
    granted_by_id: uuid.UUID | None = None,
) -> QuestMember | None:
    """有効メンバーの権限セットを置換（C.3 PUT .../permissions）。無効/不在は None。"""
    active = get_active_member(session, quest_id, user_id)
    if active is None:
        return None
    _replace_permissions(session, active, permissions, granted_by_id)
    return active


def get_permissions(session: Session, quest_member_id: uuid.UUID) -> list[str]:
    return list(
        session.execute(
            select(QuestMemberPermission.permission).where(
                QuestMemberPermission.quest_member_id == quest_member_id
            )
        ).scalars().all()
    )


def list_active_members(session: Session, quest_id: uuid.UUID) -> list[QuestMember]:
    """有効なパーティー参加（`removed_at IS NULL`）を参加日時順で取得（C.1 GET .../members）。"""
    return list(
        session.execute(
            select(QuestMember)
            .where(QuestMember.quest_id == quest_id, QuestMember.removed_at.is_(None))
            .order_by(QuestMember.joined_at)
        ).scalars().all()
    )


def list_visible_groups(session: Session, user_id: uuid.UUID, *, q: str | None = None) -> list[QuestGroup]:
    """自分が有効所属する（`quest_group_members.removed_at IS NULL`）有効グループ一覧（C.4 GET /quest-groups）。

    削除済みグループ（`deleted_at`）は除外。`q` 指定で name 部分一致。SC-10 フィルタ・SC-11 グループ選択に使う。
    """
    stmt = (
        select(QuestGroup)
        .join(QuestGroupMember, QuestGroupMember.quest_group_id == QuestGroup.id)
        .where(
            QuestGroupMember.user_id == user_id,
            QuestGroupMember.removed_at.is_(None),
            QuestGroup.deleted_at.is_(None),
        )
    )
    if q:
        stmt = stmt.where(QuestGroup.name.ilike(f"%{q}%"))
    return list(session.execute(stmt.order_by(QuestGroup.name)).scalars().all())


def list_active_group_member_user_ids(session: Session, group_id: uuid.UUID) -> set[uuid.UUID]:
    """当該グループの有効メンバー（`quest_group_members.removed_at IS NULL`）の user_id 集合（候補制限・C.3）。"""
    return set(
        session.execute(
            select(QuestGroupMember.user_id).where(
                QuestGroupMember.quest_group_id == group_id,
                QuestGroupMember.removed_at.is_(None),
            )
        ).scalars().all()
    )


def list_group_member_candidates(
    session: Session,
    group_id: uuid.UUID,
    *,
    q: str | None = None,
    exclude_user_ids: list[uuid.UUID] | None = None,
    cursor: tuple[str, uuid.UUID] | None = None,
    limit: int = 20,
) -> list:
    """パーティー候補＝当該グループの有効メンバー×`users.status='active'`（C.4 GET /quest-groups/{id}/members）。

    `exclude_user_ids`（既参加/追加中/作成者本人）を**サーバー側で除外**してからページング（C.4 決定 2026-08-02）。
    並びは display_name→id 昇順のキーセット（`cursor`＝(display_name, id)）。
    """
    from app.tenant.profile.orm import User

    stmt = (
        select(User)
        .join(QuestGroupMember, QuestGroupMember.user_id == User.id)
        .where(
            QuestGroupMember.quest_group_id == group_id,
            QuestGroupMember.removed_at.is_(None),
            User.status == "active",
        )
    )
    if exclude_user_ids:
        stmt = stmt.where(User.id.not_in(list(exclude_user_ids)))
    if q:
        stmt = stmt.where(User.display_name.ilike(f"%{q}%"))
    if cursor is not None:
        stmt = stmt.where(tuple_(User.display_name, User.id) > tuple_(cursor[0], cursor[1]))
    stmt = stmt.order_by(User.display_name.asc(), User.id.asc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def get_users_by_ids(session: Session, ids) -> dict:
    """user_id→User の dict（詳細/メンバー DTO 組み立ての N+1 回避）。"""
    from app.tenant.profile.orm import User

    id_list = list(ids)
    if not id_list:
        return {}
    return {
        u.id: u
        for u in session.execute(select(User).where(User.id.in_(id_list))).scalars().all()
    }


def get_owners_and_groups(
    session: Session, owner_ids: list[uuid.UUID], group_ids: list[uuid.UUID]
) -> tuple[dict, dict]:
    """一覧の N+1 回避＝ページ分の owner（users）と quest_group をまとめて引く（id→ORM の dict）。"""
    from app.tenant.profile.orm import User

    owners: dict = {}
    groups: dict = {}
    if owner_ids:
        owners = {
            u.id: u
            for u in session.execute(select(User).where(User.id.in_(owner_ids))).scalars().all()
        }
    if group_ids:
        groups = {
            g.id: g
            for g in session.execute(select(QuestGroup).where(QuestGroup.id.in_(group_ids))).scalars().all()
        }
    return owners, groups


def list_categories_for_quests(session: Session, quest_ids: list[uuid.UUID]) -> dict:
    """複数クエストのカテゴリをまとめて引く（quest_id→[QuestCategory]）。一覧の N+1 回避。"""
    result: dict = {}
    if not quest_ids:
        return result
    for c in session.execute(
        select(QuestCategory).where(QuestCategory.quest_id.in_(quest_ids)).order_by(QuestCategory.label)
    ).scalars().all():
        result.setdefault(c.quest_id, []).append(c)
    return result


def count_active_members(session: Session, quest_id: uuid.UUID) -> int:
    """有効パーティー人数（一覧の member_count・C.1）。"""
    return int(
        session.execute(
            select(func.count())
            .select_from(QuestMember)
            .where(QuestMember.quest_id == quest_id, QuestMember.removed_at.is_(None))
        ).scalar_one()
    )


def count_active_members_for_quests(session: Session, quest_ids: list[uuid.UUID]) -> dict:
    """複数クエストの有効パーティー人数をまとめて計上（quest_id→count・一覧の N+1 回避）。"""
    if not quest_ids:
        return {}
    rows = session.execute(
        select(QuestMember.quest_id, func.count())
        .where(QuestMember.quest_id.in_(quest_ids), QuestMember.removed_at.is_(None))
        .group_by(QuestMember.quest_id)
    ).all()
    return {qid: int(n) for qid, n in rows}


def _replace_permissions(
    session: Session,
    member: QuestMember,
    permissions: list[str],
    granted_by_id: uuid.UUID | None,
) -> None:
    """当該メンバーの権限行を全置換（重複排除・順序非依存）。UNIQUE(quest_member_id, permission)。"""
    desired = list(dict.fromkeys(permissions))  # 重複排除・順序保持
    existing = {
        p.permission: p
        for p in session.execute(
            select(QuestMemberPermission).where(QuestMemberPermission.quest_member_id == member.id)
        ).scalars().all()
    }
    for perm, row in existing.items():
        if perm not in desired:
            session.delete(row)
    for perm in desired:
        if perm not in existing:
            session.add(
                QuestMemberPermission(
                    id=uuid.uuid4(),
                    quest_member_id=member.id,
                    permission=perm,
                    granted_by_id=granted_by_id,
                )
            )
