"""アイデアコンテスト（contests）のデータアクセス（データモデル §5.60・FR-46）。

backing quest（1:1）の生成はアプリ層（quests repo を呼ぶ）。本 repo は contests 行の CRUD と一覧に徹する。
呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.contests.orm import Contest, ContestParticipant, IdeaParticipant


def create(session: Session, *, quest_id: uuid.UUID, theme: str, description: str | None,
           mode: str, status: str, starts_at, ends_at, auto_archive_days: int | None,
           prize_config: dict | None, created_by_id: uuid.UUID) -> Contest:
    c = Contest(id=uuid.uuid4(), quest_id=quest_id, theme=theme, description=description,
                mode=mode, status=status, starts_at=starts_at, ends_at=ends_at,
                auto_archive_days=auto_archive_days, prize_config=prize_config,
                created_by_id=created_by_id)
    session.add(c)
    session.flush()
    return c


def get(session: Session, contest_id: uuid.UUID) -> Contest | None:
    c = session.get(Contest, contest_id)
    if c is None or c.deleted_at is not None:
        return None
    return c


def list_all(session: Session, *, status: str | None = None) -> list[Contest]:
    """一覧（新着降順・論理削除除外）。status 指定で会期タブ絞り込み（MVP＝単純一覧・DataTable 委譲は後続）。"""
    stmt = select(Contest).where(Contest.deleted_at.is_(None))
    if status:
        stmt = stmt.where(Contest.status == status)
    return list(session.execute(stmt.order_by(Contest.created_at.desc())).scalars().all())


def touch(session: Session, contest: Contest) -> None:
    contest.updated_at = datetime.now(timezone.utc)


# ---- 参加 2階層（Tier1 contest_participants / Tier2 idea_participants・§5.61/5.62・T.2） ----

def get_contest_participation(session: Session, contest_id: uuid.UUID, user_id: uuid.UUID) -> ContestParticipant | None:
    return session.execute(
        select(ContestParticipant).where(ContestParticipant.contest_id == contest_id,
                                         ContestParticipant.user_id == user_id)
    ).scalars().first()


def upsert_contest_participation(session: Session, contest_id: uuid.UUID, user_id: uuid.UUID, *,
                                 status: str, decided_by_id: uuid.UUID | None = None) -> ContestParticipant:
    """Tier1 参加の作成/更新（冪等）。requested/approved/rejected/left を設定。"""
    row = get_contest_participation(session, contest_id, user_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = ContestParticipant(id=uuid.uuid4(), contest_id=contest_id, user_id=user_id, status=status)
        if status != "requested":
            row.decided_at, row.decided_by_id = now, decided_by_id
        session.add(row)
        session.flush()
        return row
    row.status = status
    if status != "requested":
        row.decided_at, row.decided_by_id = now, decided_by_id
    return row


def is_contest_participant(session: Session, contest_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Tier1 承認済みか（投票ゲート・案X）。"""
    row = get_contest_participation(session, contest_id, user_id)
    return row is not None and row.status == "approved"


def get_idea_participation(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> IdeaParticipant | None:
    return session.execute(
        select(IdeaParticipant).where(IdeaParticipant.idea_id == idea_id,
                                      IdeaParticipant.user_id == user_id)
    ).scalars().first()


def upsert_idea_participation(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID, *,
                              status: str, decided_by_id: uuid.UUID | None = None) -> IdeaParticipant:
    """Tier2 参加の作成/更新（冪等）。承認主体はアイデア投稿者（decided_by_id）。"""
    row = get_idea_participation(session, idea_id, user_id)
    now = datetime.now(timezone.utc)
    if row is None:
        row = IdeaParticipant(id=uuid.uuid4(), idea_id=idea_id, user_id=user_id, status=status)
        if status != "requested":
            row.decided_at, row.decided_by_id = now, decided_by_id
        session.add(row)
        session.flush()
        return row
    row.status = status
    if status != "requested":
        row.decided_at, row.decided_by_id = now, decided_by_id
    return row


def is_idea_participant(session: Session, idea_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Tier2 承認済みか（チャットゲート）。"""
    row = get_idea_participation(session, idea_id, user_id)
    return row is not None and row.status == "approved"


def contest_by_quest(session: Session, quest_id: uuid.UUID) -> Contest | None:
    """backing quest から contest を引く（コンテスト配下か判定・単一ポリシー解決用）。"""
    c = session.execute(select(Contest).where(Contest.quest_id == quest_id,
                                              Contest.deleted_at.is_(None))).scalars().first()
    return c
