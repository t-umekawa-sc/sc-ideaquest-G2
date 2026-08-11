"""`/admin/*` の認可ガード（API設計 B.0.1・imperative shell §3.1）。

認可はすべてサーバー側の権威データ（管理DB `accounts`／Redis セッション）で判定し、
リクエストの自己申告は一切信用しない（コーディング規約 §1・§2.2）。失敗コードの使い分けは
B.0.1 P6＝認証前提の不成立は 401、操作権限が無い＝403、対象が権限範囲外＝404（存在秘匿）。
"""
from __future__ import annotations

import uuid

from fastapi import Request

from app.control_plane.auth.orm import Account
from app.core.deps import require_session
from app.core.errors import AppError
from app.db.control import control_session


def require_system_admin(request: Request) -> dict:
    """system_admin 専用 EP のガード（B.0.1 P1/P2/P5/P6）。返り値＝セッション dict。

    - P1: 有効な `iq_session`（無ければ 401 `unauthenticated`）。
    - P2: 呼び出し元アカウントが `status=active`（都度 DB 再確認・disabled は 401）。
    - P5: 権威ロールは管理DB `accounts.role`（session はコピー・ロール変更は全セッション破棄で再評価）。
    - P6: system_admin でなければ 403 `forbidden`。
    """
    return _require_role(request, {"system_admin"})


def require_company_account_admin(request: Request) -> dict:
    """会社アカウント管理者 EP のガード（B.2.1・B.0.1）。返り値＝セッション dict。

    `company_account_admin`（自社スコープ）を許可。`system_admin` は**上位互換**で許可（B.2.1）。
    スコープ＝セッション会社（`session.company_id`）固定＝`/admin/accounts` は `company_id` を受けない。
    """
    return _require_role(request, {"company_account_admin", "system_admin"})


def _require_role(request: Request, allowed: set[str]) -> dict:
    session = require_session(request)  # P1
    with control_session() as s:
        account = s.get(Account, uuid.UUID(session["account_id"]))
        if account is None or account.status != "active":  # P2
            raise AppError(401, "unauthenticated")
        role = account.system_role  # P5: 権威データは DB から
    if role not in allowed:  # P6
        raise AppError(403, "forbidden")
    return session
