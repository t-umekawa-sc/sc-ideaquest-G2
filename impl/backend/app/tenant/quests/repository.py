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

from sqlalchemy import and_, delete, func, or_, select, tuple_
from sqlalchemy.orm import Session

from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests.orm import Quest, QuestCategory, QuestGroupLink, QuestMember, QuestMemberPermission

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


# ---- クエスト×クエストグループ（複数部署横断・§5.6b・FR-38）----

def create_group_links(session: Session, quest_id: uuid.UUID, primary_group_id: uuid.UUID,
                       extra_group_ids: list[uuid.UUID]) -> None:
    """作成時のリンク登録＝主（is_primary）＋追加グループ。重複/主の二重は除外。"""
    session.add(QuestGroupLink(quest_id=quest_id, quest_group_id=primary_group_id, is_primary=True))
    for gid in dict.fromkeys(extra_group_ids):  # 重複除去・順序保持
        if gid != primary_group_id:
            session.add(QuestGroupLink(quest_id=quest_id, quest_group_id=gid, is_primary=False))


def list_linked_group_ids(session: Session, quest_id: uuid.UUID) -> list[uuid.UUID]:
    """当該クエストの関連グループ id（主を先頭・以降 created_at 昇順）。"""
    rows = session.execute(
        select(QuestGroupLink.quest_group_id)
        .where(QuestGroupLink.quest_id == quest_id)
        .order_by(QuestGroupLink.is_primary.desc(), QuestGroupLink.created_at.asc())
    ).scalars().all()
    return list(rows)


def linked_groups_for_quests(session: Session, quest_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    """複数クエストの関連グループ id を一括取得（一覧 DTO・N+1 回避）。主を先頭。"""
    if not quest_ids:
        return {}
    rows = session.execute(
        select(QuestGroupLink.quest_id, QuestGroupLink.quest_group_id, QuestGroupLink.is_primary, QuestGroupLink.created_at)
        .where(QuestGroupLink.quest_id.in_(quest_ids))
        .order_by(QuestGroupLink.is_primary.desc(), QuestGroupLink.created_at.asc())
    ).all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    for qid, gid, _p, _c in rows:
        out.setdefault(qid, []).append(gid)
    return out


def reconcile_extra_links(session: Session, quest_id: uuid.UUID, primary_group_id: uuid.UUID,
                          target_group_ids: list[uuid.UUID]) -> None:
    """関連グループを「あるべき全体像」へ差分適用（主は不変・非 primary を追加/削除）。target は主を含む集合。"""
    target = {g for g in target_group_ids if g != primary_group_id}
    current = set(session.execute(
        select(QuestGroupLink.quest_group_id)
        .where(QuestGroupLink.quest_id == quest_id, QuestGroupLink.is_primary.is_(False))
    ).scalars().all())
    for gid in target - current:  # 追加
        session.add(QuestGroupLink(quest_id=quest_id, quest_group_id=gid, is_primary=False))
    to_remove = current - target
    if to_remove:  # 削除（非 primary のみ）
        session.execute(delete(QuestGroupLink).where(
            QuestGroupLink.quest_id == quest_id, QuestGroupLink.is_primary.is_(False),
            QuestGroupLink.quest_group_id.in_(to_remove)))


def active_member_user_ids(session: Session, quest_id: uuid.UUID) -> set[uuid.UUID]:
    """当該クエストの有効パーティー員 user_id 集合（門番影響判定・409）。"""
    return set(session.execute(
        select(QuestMember.user_id).where(QuestMember.quest_id == quest_id, QuestMember.removed_at.is_(None))
    ).scalars().all())


def user_ids_in_any_group(session: Session, group_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """指定グループ群のいずれかに有効所属する user_id 集合（候補範囲/門番影響の判定）。"""
    if not group_ids:
        return set()
    return set(session.execute(
        select(QuestGroupMember.user_id).where(
            QuestGroupMember.quest_group_id.in_(group_ids), QuestGroupMember.removed_at.is_(None))
    ).scalars().all())


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

    (A) 公開系＝`status != 'draft'` かつ **関連グループのいずれかに所属**（`quest_group_links` の
        いずれかが `visible_group_ids` に含まれる・FR-38 複数部署横断）かつ **自分がパーティー参加中**
        （当該クエストに `quest_members.removed_at IS NULL` の自分の行あり）。
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
    # 主グループ（quest_group_id・不変・backfill 済み）または追加リンクグループのいずれかが可視範囲内。
    # 主グループを常に含めることで link 行欠落にも頑健（FR-38 拡張前データ/直 seed も従来通り可視）。
    in_visible_group = or_(
        Quest.quest_group_id.in_(visible_group_ids or []),
        exists().where(
            QuestGroupLink.quest_id == Quest.id,
            QuestGroupLink.is_primary.is_(False),
            QuestGroupLink.quest_group_id.in_(visible_group_ids or []),
        ),
    )
    public_cond = and_(
        Quest.status != "draft",
        in_visible_group,
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
        # 関連グループ絞込＝主グループ一致 or 追加リンク一致（FR-38）。
        stmt = stmt.where(or_(
            Quest.quest_group_id == group_id,
            exists().where(
                QuestGroupLink.quest_id == Quest.id,
                QuestGroupLink.is_primary.is_(False),
                QuestGroupLink.quest_group_id == group_id,
            ),
        ))
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


def list_member_quest_ids(session: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    """自分が有効参加中（`removed_at IS NULL`）の未削除クエスト id 集合（I の未投票アイデア絞り込み用）。"""
    return list(
        session.execute(
            select(QuestMember.quest_id).join(Quest, Quest.id == QuestMember.quest_id).where(
                QuestMember.user_id == user_id,
                QuestMember.removed_at.is_(None),
                Quest.deleted_at.is_(None),
            )
        ).scalars().all()
    )


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


def list_all_active_groups(session: Session, *, q: str | None = None) -> list[QuestGroup]:
    """会社内の有効グループ全件（`deleted_at IS NULL`）を name 昇順で（部署ディレクトリ・FR-38 追加グループ選択）。

    所属に依らず会社内の全部署を返す（複数部署横断で他部署を関連付けるための選択肢・確定方針＝会社内は部署をこえて可視）。
    最小フィールド（id/code/name）のみ利用する前提。`q` 指定で name 部分一致。
    """
    stmt = select(QuestGroup).where(QuestGroup.deleted_at.is_(None))
    if q:
        stmt = stmt.where(QuestGroup.name.ilike(f"%{q}%"))
    return list(session.execute(stmt.order_by(QuestGroup.name)).scalars().all())


def get_active_group_ids(session: Session, group_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """指定 id のうち有効（`deleted_at IS NULL`）なグループ id 集合（追加グループ検証・FR-38/C.2）。"""
    if not group_ids:
        return set()
    return set(session.execute(
        select(QuestGroup.id).where(QuestGroup.id.in_(group_ids), QuestGroup.deleted_at.is_(None))
    ).scalars().all())


def get_groups_by_ids(session: Session, group_ids: list[uuid.UUID]) -> dict[uuid.UUID, QuestGroup]:
    """id→QuestGroup（詳細の関連グループ DTO 組み立て・N+1 回避）。"""
    if not group_ids:
        return {}
    return {
        g.id: g for g in session.execute(
            select(QuestGroup).where(QuestGroup.id.in_(group_ids))
        ).scalars().all()
    }


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


def list_cross_group_candidates(
    session: Session,
    group_ids: list[uuid.UUID],
    *,
    q: str | None = None,
    exclude_user_ids: list[uuid.UUID] | None = None,
    cursor: tuple[str, uuid.UUID] | None = None,
    limit: int = 20,
) -> list:
    """複数グループ横断のパーティー候補（FR-38・C.4 GET /quest-group-candidates）。

    指定グループ群のいずれかに有効所属する `users.status='active'` を display_name→id 昇順で1件ずつ返す
    （EXISTS で重複ユーザを集約）。`exclude_user_ids`（既参加/追加中/作成者）はサーバー側で除外。
    """
    from sqlalchemy import exists as sa_exists

    from app.tenant.profile.orm import User

    if not group_ids:
        return []
    stmt = select(User).where(
        User.status == "active",
        sa_exists().where(
            QuestGroupMember.user_id == User.id,
            QuestGroupMember.quest_group_id.in_(group_ids),
            QuestGroupMember.removed_at.is_(None),
        ),
    )
    if exclude_user_ids:
        stmt = stmt.where(User.id.not_in(list(exclude_user_ids)))
    if q:
        stmt = stmt.where(User.display_name.ilike(f"%{q}%"))
    if cursor is not None:
        stmt = stmt.where(tuple_(User.display_name, User.id) > tuple_(cursor[0], cursor[1]))
    stmt = stmt.order_by(User.display_name.asc(), User.id.asc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def group_ids_by_user(
    session: Session, user_ids: list[uuid.UUID], group_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """候補ユーザごとに、指定グループ群のうち有効所属する group_id 一覧（横断候補 DTO の所属バッジ表示用）。"""
    if not user_ids or not group_ids:
        return {}
    rows = session.execute(
        select(QuestGroupMember.user_id, QuestGroupMember.quest_group_id).where(
            QuestGroupMember.user_id.in_(user_ids),
            QuestGroupMember.quest_group_id.in_(group_ids),
            QuestGroupMember.removed_at.is_(None),
        )
    ).all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    for uid, gid in rows:
        out.setdefault(uid, []).append(gid)
    return out


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


def get_quests_by_ids(session: Session, ids) -> dict:
    """quest_id→Quest の dict（チームフィード等の DTO 組み立ての N+1 回避）。"""
    id_list = list(ids)
    if not id_list:
        return {}
    return {
        q.id: q
        for q in session.execute(select(Quest).where(Quest.id.in_(id_list))).scalars().all()
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
