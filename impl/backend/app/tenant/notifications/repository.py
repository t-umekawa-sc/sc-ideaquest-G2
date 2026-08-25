"""通知リポジトリ（会社DB・§5.24・ドメイン H）。すべて recipient スコープ（IDOR 対策・H.4）。

一覧＝新着降順のカーソル（§1.8）。未読集計＝index `(recipient_id, is_read, created_at)`。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.tenant.notifications.orm import Notification


def add(session: Session, n: Notification) -> Notification:
    session.add(n)
    return n


def get_for_recipient(session: Session, notif_id: uuid.UUID, recipient_id: uuid.UUID) -> Notification | None:
    """自分宛の1件（他人宛は None＝404 相当・IDOR 対策）。"""
    return session.execute(
        select(Notification).where(Notification.id == notif_id, Notification.recipient_id == recipient_id)
    ).scalars().first()


def list_for_recipient(
    session: Session,
    recipient_id: uuid.UUID,
    *,
    state: str = "all",
    types: list[str] | None = None,
    before: tuple[datetime, uuid.UUID] | None = None,
    limit: int = 30,
) -> tuple[list[Notification], bool]:
    """新着降順の一覧（§1.8）。`state=unread` は未読のみ・`types` は種別 in 絞り込み。

    返り値＝(rows, has_more)。has_more は limit+1 件取得で判定。
    """
    stmt = select(Notification).where(Notification.recipient_id == recipient_id)
    if state == "unread":
        stmt = stmt.where(Notification.is_read.is_(False))
    if types:
        stmt = stmt.where(Notification.type.in_(types))
    if before is not None:
        b_created, b_id = before
        stmt = stmt.where(
            (Notification.created_at < b_created)
            | ((Notification.created_at == b_created) & (Notification.id < b_id))
        )
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit + 1)
    rows = list(session.execute(stmt).scalars().all())
    has_more = len(rows) > limit
    return rows[:limit], has_more


def unread_count(session: Session, recipient_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count()).select_from(Notification).where(
                Notification.recipient_id == recipient_id, Notification.is_read.is_(False)
            )
        ).scalar_one()
    )


def mark_all_read(session: Session, recipient_id: uuid.UUID, *, types: list[str] | None = None) -> int:
    """自分宛の未読をすべて既読化（type 絞り込み可）。更新件数を返す。"""
    stmt = select(Notification).where(
        Notification.recipient_id == recipient_id, Notification.is_read.is_(False)
    )
    if types:
        stmt = stmt.where(Notification.type.in_(types))
    updated = 0
    for n in session.execute(stmt).scalars().all():
        n.is_read = True
        updated += 1
    return updated
