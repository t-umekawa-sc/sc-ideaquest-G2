"""会社DB 実績の永続化プリミティブ（§5.28/§5.29・G.4）。呼び出し側 Tx に相乗。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.achievements.orm import Achievement, UserAchievement


def list_achievements(session: Session) -> list[Achievement]:
    return list(session.execute(select(Achievement).order_by(Achievement.sort_order)).scalars().all())


def get_user_achievement(session: Session, user_id: uuid.UUID, achievement_id: uuid.UUID) -> UserAchievement | None:
    return session.execute(
        select(UserAchievement).where(UserAchievement.user_id == user_id, UserAchievement.achievement_id == achievement_id)
    ).scalars().first()


def list_user_achievements(session: Session, user_id: uuid.UUID) -> dict[uuid.UUID, UserAchievement]:
    rows = session.execute(select(UserAchievement).where(UserAchievement.user_id == user_id)).scalars().all()
    return {r.achievement_id: r for r in rows}


def upsert_user_achievement(
    session: Session, user_id: uuid.UUID, achievement_id: uuid.UUID, *, current: int, target: int | None
) -> UserAchievement:
    row = get_user_achievement(session, user_id, achievement_id)
    if row is None:
        row = UserAchievement(id=uuid.uuid4(), user_id=user_id, achievement_id=achievement_id,
                              progress_current=current, progress_target=target)
        session.add(row)
        session.flush()
        return row
    row.progress_current = current
    row.progress_target = target
    return row
