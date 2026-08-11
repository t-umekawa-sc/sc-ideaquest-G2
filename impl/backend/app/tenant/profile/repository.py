"""会社DB（テナントプレーン）の users ミラー参照。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.tenant.profile.orm import User


def get_user_by_account(session: Session, account_id: uuid.UUID) -> User | None:
    return session.execute(
        select(User).where(User.account_id == account_id)
    ).scalar_one_or_none()


# accounts → users にミラーしてよい列（源泉=accounts・§4.6）。存在しない列は無視（前方互換）。
_MIRROR_FIELDS = (
    "display_name", "locale", "status", "password_set", "last_login_at",
    "login_id", "email", "system_role",  # identity/role のミラー（§5.3・会社DB単独一覧）
)
# JSONB payload では日時は ISO 文字列で運ぶため、適用前に datetime へ戻す列。
_DATETIME_FIELDS = ("last_login_at",)


def upsert_user_mirror(session: Session, account_id: uuid.UUID, payload: dict) -> None:
    """会社DB `users` を `account_id` をキーに upsert（冪等・at-least-once 前提・§4.6）。

    payload のうち `_MIRROR_FIELDS` に該当する列だけを反映（未知キーは無視＝前方互換）。
    行が無ければ作成（B.5 発行時の初回ミラー。`display_name` を含まない payload では作成できない）。
    """
    fields = {k: payload[k] for k in _MIRROR_FIELDS if k in payload}
    for key in _DATETIME_FIELDS:  # JSONB の ISO 文字列 → datetime（timestamptz 列へ）
        if isinstance(fields.get(key), str):
            fields[key] = datetime.fromisoformat(fields[key])
    user = get_user_by_account(session, account_id)
    if user is None:
        session.add(User(id=uuid.uuid4(), account_id=account_id, **fields))
    else:
        for key, value in fields.items():
            setattr(user, key, value)
