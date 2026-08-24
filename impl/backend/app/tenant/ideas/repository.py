"""会社DB アイデア・利害関係者・添付・投票・版・フォローの永続化プリミティブ（§5.10〜§5.14・§5.23・D.1〜D.6）。

方針（quests.repository と同じ）:
- いずれも呼び出し側の Tx に相乗（自身では commit しない）＝application が UoW 境界を持つ。
- 論理削除はトゥームストーン（ideas=`deleted_at`）。有効行のみを返す関数は `deleted_at IS NULL` で絞る。
- 一覧はキーセット（カーソル）ページング（§1.8）。ソートタプル `(created_at, id)` DESC を既定。
- 認可（権限・門番・状態機械）は application 層で強制する。本 repository は永続化の原子操作のみ。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, func, or_, select, tuple_
from sqlalchemy.orm import Session

from app.tenant.ideas.orm import Attachment, Follow, Idea, IdeaRevision, IdeaStakeholder, Vote


# ---- アイデア本体（D.1/D.2） ----

def create_idea(
    session: Session,
    *,
    quest_id: uuid.UUID,
    author_id: uuid.UUID,
    title: str,
    body: str,
    value: str,
    status: str,
    time_limit=None,
    note: str | None = None,
    idea_id: uuid.UUID | None = None,
) -> Idea:
    """アイデアを1件作成（利害関係者/添付/版は別プリミティブ）。投稿者を author_id に保存。"""
    idea = Idea(
        id=idea_id or uuid.uuid4(),
        quest_id=quest_id,
        author_id=author_id,
        title=title,
        body=body,
        value=value,
        status=status,
        time_limit=time_limit,
        note=note,
    )
    session.add(idea)
    return idea


def get_idea(session: Session, idea_id: uuid.UUID) -> Idea | None:
    """有効なアイデア（`deleted_at IS NULL`）を1件取得。削除済み/不在は None。"""
    return session.execute(
        select(Idea).where(Idea.id == idea_id, Idea.deleted_at.is_(None))
    ).scalars().first()


def list_ideas_for_quest(
    session: Session,
    *,
    quest_id: uuid.UUID,
    viewer_id: uuid.UUID,
    status: list[str] | None = None,
    cursor: tuple[datetime, uuid.UUID] | None = None,
    limit: int = 20,
) -> list[Idea]:
    """クエスト内アイデア（D.1・SC-12 アイデアタブ）を新着順（created_at,id DESC）で取得。

    (A) 公開＝`status='published'`（当該クエスト）／(B) 自分の下書き＝`status='draft'` かつ `author_id=viewer_id`。
    どちらも `deleted_at IS NULL`。`status` 指定でさらに絞る（例＝`['published']`）。
    """
    public_cond = and_(Idea.quest_id == quest_id, Idea.status == "published")
    draft_cond = and_(Idea.quest_id == quest_id, Idea.status == "draft", Idea.author_id == viewer_id)
    stmt = select(Idea).where(Idea.deleted_at.is_(None), or_(public_cond, draft_cond))
    if status:
        stmt = stmt.where(Idea.status.in_(status))
    if cursor is not None:
        stmt = stmt.where(tuple_(Idea.created_at, Idea.id) < tuple_(cursor[0], cursor[1]))
    stmt = stmt.order_by(Idea.created_at.desc(), Idea.id.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


# ---- 利害関係者（D.2・§5.11） ----

def list_stakeholders(session: Session, idea_id: uuid.UUID) -> list[IdeaStakeholder]:
    return list(
        session.execute(
            select(IdeaStakeholder).where(IdeaStakeholder.idea_id == idea_id).order_by(IdeaStakeholder.label)
        ).scalars().all()
    )


def replace_stakeholders(session: Session, idea_id: uuid.UUID, entries: list[tuple[str, bool]]) -> None:
    """利害関係者を置換セットで全置換（§5.11）。`entries`＝正規化済み (label, is_custom)。"""
    for row in session.execute(
        select(IdeaStakeholder).where(IdeaStakeholder.idea_id == idea_id)
    ).scalars().all():
        session.delete(row)
    session.flush()
    for label, is_custom in entries:
        session.add(IdeaStakeholder(id=uuid.uuid4(), idea_id=idea_id, label=label, is_custom=is_custom))


# ---- 版（D.4・§5.14） ----

def add_revision(
    session: Session, idea_id: uuid.UUID, *, revision: int, editor_id: uuid.UUID, changes: dict, memo: str | None = None
) -> IdeaRevision:
    """版を1つ追加（`UNIQUE(idea_id, revision)`）。`changes`＝対象フィールド全値のスナップショット（§8-⑤）。"""
    rev = IdeaRevision(
        id=uuid.uuid4(), idea_id=idea_id, revision=revision, editor_id=editor_id, changes=changes, memo=memo
    )
    session.add(rev)
    return rev


def list_revisions(session: Session, idea_id: uuid.UUID) -> list[IdeaRevision]:
    """版タイムライン（新しい順・SC-22 更新履歴）。"""
    return list(
        session.execute(
            select(IdeaRevision).where(IdeaRevision.idea_id == idea_id).order_by(IdeaRevision.revision.desc())
        ).scalars().all()
    )


def get_revision(session: Session, idea_id: uuid.UUID, revision: int) -> IdeaRevision | None:
    return session.execute(
        select(IdeaRevision).where(IdeaRevision.idea_id == idea_id, IdeaRevision.revision == revision)
    ).scalars().first()


# ---- 投票（D.5・§5.13） ----

def get_vote(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> Vote | None:
    return session.execute(
        select(Vote).where(Vote.idea_id == idea_id, Vote.user_id == user_id)
    ).scalars().first()


def upsert_vote(
    session: Session, idea_id: uuid.UUID, user_id: uuid.UUID, *, type: str, voted_revision: int
) -> tuple[Vote, bool]:
    """投票を登録/切替（1人1票）。返り値＝(vote, created)。created=True は当該アイデア初回（XP は application で付与）。"""
    existing = get_vote(session, idea_id, user_id)
    if existing is not None:
        existing.type = type
        existing.voted_revision = voted_revision
        return existing, False
    vote = Vote(id=uuid.uuid4(), idea_id=idea_id, user_id=user_id, type=type, voted_revision=voted_revision)
    session.add(vote)
    return vote, True


def remove_vote(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """投票を取消（行削除・XP は戻さない・§8-⑥）。削除したら True・無ければ False（冪等）。"""
    existing = get_vote(session, idea_id, user_id)
    if existing is None:
        return False
    session.delete(existing)
    return True


def count_votes(session: Session, idea_id: uuid.UUID) -> dict[str, int]:
    """当該アイデアの賛成/反対数（`{"approve": n, "oppose": m}`）。"""
    rows = session.execute(
        select(Vote.type, func.count()).where(Vote.idea_id == idea_id).group_by(Vote.type)
    ).all()
    result = {"approve": 0, "oppose": 0}
    for t, n in rows:
        result[t] = int(n)
    return result


def count_published_ideas_for_quests(session: Session, quest_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """クエストごとの公開アイデア数（C.1 `idea_count`・下書き/削除は除外・N+1 回避）。

    定義＝`status='published'` かつ `deleted_at IS NULL`（API設計 C.1 idea_count・下書きは存在漏れ防止で
    数えない）。返す dict は集計 0 のクエストを含まない（呼び出し側で `.get(qid, 0)`）。
    """
    result: dict[uuid.UUID, int] = {}
    if not quest_ids:
        return result
    rows = session.execute(
        select(Idea.quest_id, func.count())
        .where(Idea.quest_id.in_(quest_ids), Idea.status == "published", Idea.deleted_at.is_(None))
        .group_by(Idea.quest_id)
    ).all()
    for qid, n in rows:
        result[qid] = int(n)
    return result


def count_votes_for_ideas(session: Session, idea_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, int]]:
    """複数アイデアの賛成/反対数をまとめて集計（一覧の N+1 回避）。"""
    result: dict[uuid.UUID, dict[str, int]] = {}
    if not idea_ids:
        return result
    rows = session.execute(
        select(Vote.idea_id, Vote.type, func.count())
        .where(Vote.idea_id.in_(idea_ids))
        .group_by(Vote.idea_id, Vote.type)
    ).all()
    for iid, t, n in rows:
        result.setdefault(iid, {"approve": 0, "oppose": 0})[t] = int(n)
    return result


# ---- 添付（D.3・§5.12） ----

def add_attachment(
    session: Session, *, idea_id: uuid.UUID, object_key: str, original_name: str,
    size_bytes: int, mime_type: str, uploaded_by_id: uuid.UUID,
) -> Attachment:
    att = Attachment(
        id=uuid.uuid4(), idea_id=idea_id, object_key=object_key, original_name=original_name,
        size_bytes=size_bytes, mime_type=mime_type, uploaded_by_id=uploaded_by_id,
    )
    session.add(att)
    return att


def list_attachments(session: Session, idea_id: uuid.UUID) -> list[Attachment]:
    return list(
        session.execute(
            select(Attachment).where(Attachment.idea_id == idea_id).order_by(Attachment.uploaded_at)
        ).scalars().all()
    )


def get_attachment(session: Session, attachment_id: uuid.UUID) -> Attachment | None:
    return session.execute(select(Attachment).where(Attachment.id == attachment_id)).scalars().first()


def remove_attachment(session: Session, attachment: Attachment) -> None:
    session.delete(attachment)


def count_attachments(session: Session, idea_id: uuid.UUID) -> int:
    """アイデアの添付数（1投稿 10 件上限の判定・§8-⑦）。"""
    return int(
        session.execute(
            select(func.count()).select_from(Attachment).where(Attachment.idea_id == idea_id)
        ).scalar_one()
    )


# ---- フォロー（D.6・§5.23） ----

def is_following(session: Session, user_id: uuid.UUID, idea_id: uuid.UUID) -> bool:
    return (
        session.execute(
            select(Follow.id).where(Follow.user_id == user_id, Follow.idea_id == idea_id)
        ).first()
        is not None
    )


def add_follow(session: Session, user_id: uuid.UUID, idea_id: uuid.UUID) -> Follow:
    """フォロー（冪等＝既存なら再利用・`UNIQUE(user_id, idea_id)`・§5.23）。"""
    existing = session.execute(
        select(Follow).where(Follow.user_id == user_id, Follow.idea_id == idea_id)
    ).scalars().first()
    if existing is not None:
        return existing
    follow = Follow(id=uuid.uuid4(), user_id=user_id, idea_id=idea_id)
    session.add(follow)
    return follow


def remove_follow(session: Session, user_id: uuid.UUID, idea_id: uuid.UUID) -> bool:
    """フォロー解除（冪等＝無ければ False）。"""
    existing = session.execute(
        select(Follow).where(Follow.user_id == user_id, Follow.idea_id == idea_id)
    ).scalars().first()
    if existing is None:
        return False
    session.delete(existing)
    return True


def list_followed_idea_ids(session: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        session.execute(select(Follow.idea_id).where(Follow.user_id == user_id)).scalars().all()
    )
