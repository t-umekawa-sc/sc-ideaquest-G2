"""認証ユースケース（application＝エンドポイント 1:1・§3.1/§3.4）。

login はコントロールプレーンで完結し、認証成立時のみ会社DBミラーから表示情報を解決する（A.1/A.6）。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import redis

from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.domain.service import (
    LoginDecision,
    decide_login,
    password_policy_errors,
)
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import (
    check_login_rate_limit,
    create_session,
    delete_account_sessions,
    delete_session,
    generate_token,
    hash_password,
    hash_token,
    read_session,
    verify_password,
    within_pw_request_rate_limit,
)
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.mail import get_mail_sender
from app.tenant.profile import repository as user_repo


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
    check_login_rate_limit(r, client_ip, login_id)

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
        token = create_session(r, payload)  # 毎回新トークン（固定化対策）
        csrf = generate_token()
        return LoginResult(status="authenticated", session=payload, session_token=token, csrf_token=csrf)


# GET /auth/session で外部に返す A.6 のキー（内部管理フィールド created_at 等は返さない）
_SESSION_PUBLIC_KEYS = ("account_id", "company_id", "company_code", "system_role", "locale", "user")


def get_session(r: redis.Redis, token: str | None) -> dict:
    session = read_session(r, token) if token else None
    if session is None:
        raise AppError(401, "unauthenticated")
    return {k: session[k] for k in _SESSION_PUBLIC_KEYS if k in session}


def logout(r: redis.Redis, token: str | None) -> None:
    if token:
        delete_session(r, token)


# --- 初回・再設定パスワード（A.7・状態B/D・ADR-0002） ------------------------------------
def _send_password_setup_email(to_email: str, token: str) -> None:
    """設定リンク（72h・単回）をメール送信。トークンはリンクにのみ載せログには出さない。"""
    s = get_settings()
    link = f"{s.app_base_url}/password-setup?token={token}"
    subject = "【ideaquest】パスワード設定のご案内"
    body = (
        "ideaquest のパスワード設定/再設定のご案内です。\n\n"
        "以下のリンクから新しいパスワードを設定してください（有効期限 72 時間・1回限り）。\n"
        f"{link}\n\n"
        "このメールに心当たりがない場合は破棄してください。"
    )
    get_mail_sender().send(to_email, subject, body)


def request_password_setup(
    r: redis.Redis, client_ip: str, company_code: str, login_id: str
) -> None:
    """自己サービスの再設定要求（状態D）。列挙耐性のため常に 202（呼び出し側で固定応答）。

    実メール送信は「会社 active かつアカウント active」かつレート制限内のときだけ。
    該当しなければ無送信で同一応答（A.7／ADR-0002 §2.3）。
    """
    # NOTE(timing): eligible 経路は同期メール送信のぶん遅く、残余のタイミング差が残る
    # （既知の MVP 限界・ADR-0002 §2.3）。完全な等時間化は非同期送信（worker）導入時に対応。
    within_limit = within_pw_request_rate_limit(r, client_ip, company_code, login_id)

    with control_session() as session:
        account, company = account_repo.find_account_and_company(session, company_code, login_id)
        eligible = (
            within_limit
            and company is not None
            and company.status == "active"
            and account is not None
            and account.status == "active"
        )
        if not eligible:
            return  # 無送信・同一の 202（列挙耐性）

        token = generate_token()
        to_email = account.email
        s = get_settings()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=s.password_setup_ttl_seconds)
        account_repo.invalidate_password_setup_challenges(session, account.id)  # 最新のみ有効
        account_repo.create_password_setup_challenge(session, account.id, hash_token(token), expires_at)
        session.commit()

    # DB コミット後に送信（未永続のトークンをメールしないため・post-commit）
    _send_password_setup_email(to_email, token)


def verify_password_setup(token: str) -> dict:
    """設定リンクの有効性確認（状態Bの表示可否）。無効/期限切れ/使用済は一律 410。"""
    with control_session() as session:
        challenge = account_repo.find_password_setup_challenge_by_hash(session, hash_token(token))
        if not _challenge_is_valid(challenge):
            raise AppError(410, "token_expired")
        account = account_repo.get_account(session, challenge.account_id)
        return {"valid": True, "login_id": account.login_id}


def complete_password_setup(r: redis.Redis, token: str, new_password: str) -> None:
    """新パスワードを設定（状態B→ログイン画面A）。成功で全アクティブセッション破棄（A.9-③）。"""
    errors = password_policy_errors(new_password)
    if errors:
        raise AppError(422, "validation_error", detail="パスワードがポリシーを満たしません", errors=errors)

    with control_session() as session:
        challenge = account_repo.find_password_setup_challenge_by_hash(session, hash_token(token))
        if not _challenge_is_valid(challenge):
            raise AppError(410, "token_expired")
        account = account_repo.get_account(session, challenge.account_id)
        account.password_hash = hash_password(new_password)  # password_hash 非NULL＝password_set=true
        challenge.used_at = datetime.now(timezone.utc)  # 単回消費
        account_id = str(account.id)
        session.commit()
        # TODO(outbox): 同一Tx で account_sync_outbox に password_set ミラーを INSERT する
        # （データモデル §4.6・A.7）。worker/列拡張とまとめて outbox スライスで実装（ADR-0002 §2.4）。

    # PW 変更で当該アカウントの全セッションを破棄（A.9-③・ここでは新セッションは張らない）
    delete_account_sessions(r, account_id)


def _challenge_is_valid(challenge) -> bool:
    return (
        challenge is not None
        and challenge.used_at is None
        and challenge.expires_at > datetime.now(timezone.utc)
    )
