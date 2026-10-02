"""アイデアコンテスト（contests）のデータアクセス（データモデル §5.60・FR-46）。

backing quest（1:1）の生成はアプリ層（quests repo を呼ぶ）。本 repo は contests 行の CRUD と一覧に徹する。
呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.contests.orm import Contest


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
