"""`/me`（自己プロフィール）の認可ガード（K.0・imperative shell §3.1）。

自分自身の identity は管理DB `accounts` が源泉。ログイン済み（P1）かつ当該アカウントが `active`（P2）
であることだけを要求する（ロールは問わない＝一般利用者の自己編集）。company/account はセッション由来。
"""
from __future__ import annotations

import uuid

from fastapi import Request

from app.control_plane.auth.orm import Account
from app.core.deps import require_session
from app.core.errors import AppError
from app.db.control import control_session


def require_me(request: Request) -> dict:
    """有効な active セッションを要求（P1/P2）。返り値＝セッション dict（`account_id`/`company_id`）。"""
    session = require_session(request)  # P1: セッション必須（無ければ 401）
    with control_session() as s:
        account = s.get(Account, uuid.UUID(session["account_id"]))
        if account is None or account.status != "active":  # P2: 都度 DB 再確認（disabled は 401）
            raise AppError(401, "unauthenticated")
    return session
