"""②会社レベル能力（user_capabilities）のデータアクセス（データモデル §5.63・FR-47）。

有効な付与は `revoked_at IS NULL` の行。付与は冪等（既に有効なら何もしない）、剥奪は論理（`revoked_at`）。
呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.tenant.capabilities.orm import UserCapability


def has_capability(session: Session, user_id: uuid.UUID, capability: str) -> bool:
    """当該ユーザーが有効な能力を持つか（`revoked_at IS NULL`）。"""
    return session.execute(
        select(UserCapability.id).where(
            UserCapability.user_id == user_id,
            UserCapability.capability == capability,
            UserCapability.revoked_at.is_(None),
        ).limit(1)
    ).first() is not None


def list_for_user(session: Session, user_id: uuid.UUID) -> list[str]:
    """当該ユーザーの有効な能力名一覧。"""
    rows = session.execute(
        select(UserCapability.capability).where(
            UserCapability.user_id == user_id, UserCapability.revoked_at.is_(None)
        )
    ).scalars().all()
    return list(rows)


def list_holders(session: Session, capability: str) -> list[uuid.UUID]:
    """当該能力を有効に持つユーザー id 一覧（通知の運営宛先解決等・`revoked_at IS NULL`）。"""
    rows = session.execute(
        select(UserCapability.user_id).where(
            UserCapability.capability == capability, UserCapability.revoked_at.is_(None)
        )
    ).scalars().all()
    return list(dict.fromkeys(rows))


def grant(session: Session, user_id: uuid.UUID, capability: str, *, granted_by_id: uuid.UUID | None) -> bool:
    """能力を付与（既に有効なら何もしない＝冪等）。新規付与なら True。"""
    if has_capability(session, user_id, capability):
        return False
    session.add(UserCapability(id=uuid.uuid4(), user_id=user_id, capability=capability,
                               granted_by_id=granted_by_id))
    return True


def revoke(session: Session, user_id: uuid.UUID, capability: str) -> int:
    """能力を論理剥奪（`revoked_at` を立てる）。剥奪した行数を返す。"""
    now = datetime.now(timezone.utc)
    return session.execute(
        update(UserCapability).where(
            UserCapability.user_id == user_id,
            UserCapability.capability == capability,
            UserCapability.revoked_at.is_(None),
        ).values(revoked_at=now)
    ).rowcount
