"""会社DB ゲーミフィケーション元帳（activities）の参照・追記（テナントプレーン）。

クエリ/永続は本 repository に閉じ込め、UoW（残高整合）は `ledger` が担う（§3.4 4層）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.tenant.gamification.orm import Activity


def add(session: Session, activity: Activity) -> Activity:
    session.add(activity)
    return activity


def exists_reason_between(
    session: Session, user_id: uuid.UUID, reason: str, start: datetime, end: datetime
) -> bool:
    """`user_id` に `reason` の付与が半開区間 `[start, end)` に既にあるか（日次冪等判定・§5.27）。"""
    stmt = (
        select(func.count())
        .select_from(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.reason == reason,
            Activity.created_at >= start,
            Activity.created_at < end,
        )
    )
    return session.execute(stmt).scalar_one() > 0


def exists_ref(
    session: Session, user_id: uuid.UUID, kind: str, reason: str,
    ref_type: str | None, ref_id: uuid.UUID | None,
) -> bool:
    """`(user_id, kind, reason, ref_type, ref_id)` の付与が既にあるか（参照単位の冪等・投票 XP 方式・§7）。"""
    stmt = (
        select(func.count())
        .select_from(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.kind == kind,
            Activity.reason == reason,
            Activity.ref_type == ref_type,
            Activity.ref_id == ref_id,
        )
    )
    return session.execute(stmt).scalar_one() > 0
