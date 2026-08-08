"""認証ユースケース（application＝エンドポイント 1:1・§3.1/§3.4）。

login はコントロールプレーンで完結し、認証成立時のみ会社DBミラーから表示情報を解決する（A.1/A.6）。
"""
from __future__ import annotations

from dataclasses import dataclass

import redis

from app.core.db import control_session, get_tenant_session
from app.core.errors import AppError
from app.core.security import verify_password
from app.domain.auth import LoginDecision, decide_login
from app.repository import account_repo, rate_limit_repo, session_repo, user_repo


@dataclass
class LoginResult:
    status: str                 # "authenticated" | "mfa_required"
    session: dict | None = None
    session_token: str | None = None
    csrf_token: str | None = None
    mfa: dict | None = None


def _build_session_payload(account, company, user) -> dict:
    """A.6 セッションスキーマ。user は会社DBミラー（表示用）。"""
    return {
        "account_id": str(account.id),
        "company_id": str(company.id),
        "company_code": company.company_code,
        "system_role": account.system_role,
        "locale": account.locale,
        "user": {
            "user_id": str(user.id) if user else None,
            "display_name": (user.display_name if user else account.display_name),
            "avatar_url": None,  # 署名URL化は K/画像スライスで（§1.10）
        },
    }


def login(r: redis.Redis, client_ip: str, company_code: str, login_id: str, password: str) -> LoginResult:
    rate_limit_repo.check_login_rate_limit(r, client_ip, login_id)

    with control_session() as session:
        account, company = account_repo.find_account_and_company(session, company_code, login_id)

        # 列挙耐性: 結果に関わらず必ず PW 照合を実行（未存在はダミーハッシュ・ADR §2.5）
        pw_hash = account.password_hash if account else None
        credentials_ok = (
            account is not None
            and account.status == "active"
            and verify_password(password, pw_hash)
        )
        company_status = company.status if company else "active"

        decision = decide_login(credentials_ok, company_status)
        if decision is LoginDecision.INVALID:
            raise AppError(401, "unauthenticated")
        if decision is LoginDecision.COMPANY_SUSPENDED:
            raise AppError(503, "company_suspended")

        # PROCEED。MFA 要否は会社設定で分岐（本スライスのシードは mfa_required=false）
        if company.mfa_required:
            # NOTE: MFA（pre-auth/OTP）は MFA スライスで実装。ここでは契約形のみ返す。
            return LoginResult(status="mfa_required", mfa={"delivery": "email"})

        # 認証成立: 会社DBミラーから表示情報を解決（A.6）
        with get_tenant_session(company.db_identifier) as tsession:
            user = user_repo.get_user_by_account(tsession, account.id)

        payload = _build_session_payload(account, company, user)
        token = session_repo.create_session(r, payload)  # 毎回新トークン（固定化対策）
        from app.core.security import generate_token

        csrf = generate_token()
        return LoginResult(status="authenticated", session=payload, session_token=token, csrf_token=csrf)


# GET /auth/session で外部に返す A.6 のキー（内部管理フィールド created_at 等は返さない）
_SESSION_PUBLIC_KEYS = ("account_id", "company_id", "company_code", "system_role", "locale", "user")


def get_session(r: redis.Redis, token: str | None) -> dict:
    session = session_repo.get_session(r, token) if token else None
    if session is None:
        raise AppError(401, "unauthenticated")
    return {k: session[k] for k in _SESSION_PUBLIC_KEYS if k in session}


def logout(r: redis.Redis, token: str | None) -> None:
    if token:
        session_repo.delete_session(r, token)
