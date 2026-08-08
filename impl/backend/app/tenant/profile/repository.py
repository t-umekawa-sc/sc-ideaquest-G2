"""会社DB（テナントプレーン）の users ミラー参照。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.profile.orm import User


def get_user_by_account(session: Session, account_id: uuid.UUID) -> User | None:
    return session.execute(
        select(User).where(User.account_id == account_id)
    ).scalar_one_or_none()
