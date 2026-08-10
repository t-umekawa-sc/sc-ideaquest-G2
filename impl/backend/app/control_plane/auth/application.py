"""認証ユースケース（application＝エンドポイント 1:1・§3.1/§3.4）。

login はコントロールプレーンで完結し、認証成立時のみ会社DBミラーから表示情報を解決する（A.1/A.6）。
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import redis

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.domain.service import (
    LoginDecision,
    decide_login,
    mask_email,
    password_policy_errors,
)
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import (
    check_login_rate_limit,
    clear_login_lock,
    clear_login_locks_for_login_id,
    create_preauth,
    create_session,
    delete_account_sessions,
    delete_preauth,
    delete_session,
    generate_otp,
    generate_token,
    hash_password,
    hash_token,
    is_login_locked,
    read_session,
    register_login_failure,
    save_preauth,
    should_send_lock_notification,
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
    preauth_token: str | None = None
    trust_token: str | None = None   # verify で trust_device=true のとき発行（iq_trust）


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


def _issue_session(r: redis.Redis, account, company) -> LoginResult:
    """認証成立→会社DBミラーから表示情報を解決し本セッション発行（A.6・毎回新トークン＝固定化対策）。"""
    with get_tenant_session(company.db_identifier) as tsession:
        user = user_repo.get_user_by_account(tsession, account.id)
    payload = _build_session_payload(account, company, user)
    token = create_session(r, payload)
    csrf = generate_token()
    return LoginResult(status="authenticated", session=payload, session_token=token, csrf_token=csrf)


def login(
    r: redis.Redis, client_ip: str, company_code: str, login_id: str, password: str,
    trust_token: str | None = None,
) -> LoginResult:
    check_login_rate_limit(r, client_ip, login_id)  # 第一層＝粗い (IP+login_id) レート制限（429）

    # 第二層＝(IP+login_id) 一時ロック（ADR-0005 §2.3）。ロック中は資格照合に到達させないが、
    # 応答は誤資格と同一の 401 とし、タイミング差を作らないためダミー照合だけ行う（列挙耐性・A.1）。
    if is_login_locked(r, client_ip, login_id):
        verify_password(password, None)
        raise AppError(401, "unauthenticated")

    lock_notify: tuple[str, str] | None = None  # ロック発火時に通知すべき (account_id, email)
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
        if decision is LoginDecision.COMPANY_SUSPENDED:
            raise AppError(503, "company_suspended")

        if decision is LoginDecision.INVALID:
            # 認証失敗を計数。閾値到達でロック発火＝実在 active のときだけ本人へ通知（§2.4）。
            # メール送信は列挙耐性のため session を閉じてから（§2.4・下記）。
            if register_login_failure(r, client_ip, login_id) and account is not None and account.status == "active":
                lock_notify = (str(account.id), account.email)
        else:
            # PROCEED＝資格照合成功。失敗計数とロックを解除する（§2.2 成功で streak と lock 削除）。
            clear_login_lock(r, client_ip, login_id)

            # MFA 要否は会社設定で分岐。信頼端末（iq_trust）が有効なら MFA スキップ（A.0-①）
            needs_mfa = company.mfa_required
            if needs_mfa and trust_token:
                td = account_repo.find_active_trusted_device(session, account.id, hash_token(trust_token))
                if td is not None:
                    td.last_used_at = datetime.now(timezone.utc)
                    session.commit()
                    needs_mfa = False

            if not needs_mfa:
                return _issue_session(r, account, company)  # 本セッション発行（ORM 接続中に解決）

            # 要MFA: OTP 送信に必要な値だけ確定してセッションを閉じる（以降 Redis/メール）
            mfa_account_id = str(account.id)
            mfa_company_id = str(company.id)
            mfa_email = account.email

    # ここに到達するのは INVALID か 要MFA のいずれか
    if decision is LoginDecision.INVALID:
        # session を閉じてから通知（SMTP 中に DB 接続を保持しない）。宛先無し/クールダウン中は無送信
        if lock_notify is not None:
            account_id, email = lock_notify
            if should_send_lock_notification(r, account_id):
                _send_lock_notification(email)
        raise AppError(401, "unauthenticated")

    # --- 要MFA（A.0-②）: OTP 発行＋pre-auth 発行＋メール送信 ---
    s = get_settings()
    otp = generate_otp(s.otp_length)
    preauth_token = create_preauth(r, mfa_account_id, mfa_company_id, hash_token(otp))
    csrf = generate_token()
    _send_otp_email(mfa_email, otp)
    mfa = {
        "delivery": "email",
        "masked_to": mask_email(mfa_email),
        "expires_in": s.otp_ttl_seconds,
        "resend_available_in": s.otp_resend_cooldown_seconds,
    }
    return LoginResult(status="mfa_required", mfa=mfa, preauth_token=preauth_token, csrf_token=csrf)


def _send_otp_email(to_email: str, otp: str) -> None:
    """MFA の OTP をメール送信。OTP は本文にのみ載せ、ログには出さない（セキュリティ一覧 3・15）。"""
    s = get_settings()
    minutes = s.otp_ttl_seconds // 60
    subject = "【ideaquest】ログイン認証コード"
    body = (
        "ideaquest のログイン認証コードです。\n\n"
        f"認証コード: {otp}\n"
        f"（有効期限 {minutes} 分・1回限り）\n\n"
        "このメールに心当たりがない場合は破棄してください。"
    )
    get_mail_sender().send(to_email, subject, body)


def _send_lock_notification(to_email: str) -> None:
    """アカウント一時ロックを本人へ out-of-band 通知（ADR-0005 §2.4）。

    本文は汎用＝攻撃元 IP・失敗回数・MFA 有無などの詳細は載せない（列挙耐性・情報過多の回避）。
    """
    subject = "【ideaquest】ログインの一時制限のお知らせ"
    body = (
        "あなたのアカウントでログインの失敗が続いたため、一時的にログインを制限しました。\n\n"
        "しばらく時間をおくと自動的に解除されます。\n"
        "心当たりがない場合は、パスワードの再設定をおすすめします。\n\n"
        "このメールに心当たりがない場合は破棄してください。"
    )
    get_mail_sender().send(to_email, subject, body)


def verify_mfa(
    r: redis.Redis, preauth_token: str, preauth: dict, code: str, trust_device: bool
) -> LoginResult:
    """pre-auth 中の OTP を検証し本セッション発行（A.0-③）。失敗上限で pre-auth 失効（A.0-④）。"""
    s = get_settings()
    now = int(time.time())
    if now > preauth["otp_expires_at"]:
        raise AppError(401, "otp_expired")

    if hash_token(code) != preauth["otp_hash"]:
        preauth["attempts"] = preauth.get("attempts", 0) + 1
        attempts_left = max(0, s.otp_max_attempts - preauth["attempts"])
        if attempts_left == 0:
            delete_preauth(r, preauth_token)  # 上限到達＝pre-auth 破棄（login やり直し）
        else:
            save_preauth(r, preauth_token, preauth)
        raise AppError(401, "otp_invalid", extra={"attempts_left": attempts_left})

    # OTP 一致: 本セッション発行。account/company を引き直す（pre-auth は id のみ保持）
    account_id = preauth["account_id"]
    with control_session() as session:
        account = account_repo.get_account(session, account_id)
        company = account_repo.get_company(session, account.company_id) if account else None
        if account is None or company is None:
            raise AppError(401, "preauth_expired")
        result = _issue_session(r, account, company)

        if trust_device:
            trust_token = generate_token()
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=s.trusted_device_ttl_seconds)
            account_repo.create_trusted_device(session, account.id, hash_token(trust_token), expires_at)
            session.commit()
            result.trust_token = trust_token

    delete_preauth(r, preauth_token)  # pre-auth 消費（固定化対策・A.0-③）
    return result


def resend_mfa(r: redis.Redis, preauth_token: str, preauth: dict) -> dict:
    """OTP を再送（旧OTP失効・新OTP発行）。クールダウン中は 429。pre-auth TTL は延ばさない（§2.2）。"""
    s = get_settings()
    now = int(time.time())
    if now < preauth.get("resend_available_at", 0):
        retry_after = preauth["resend_available_at"] - now
        raise AppError(
            429, "rate_limited", detail=f"retry after {retry_after}s",
            headers={"Retry-After": str(retry_after)},
        )

    otp = generate_otp(s.otp_length)
    preauth["otp_hash"] = hash_token(otp)
    preauth["otp_expires_at"] = now + s.otp_ttl_seconds
    preauth["attempts"] = 0  # 新コードなので失敗回数リセット（resend 自体がクールダウンで律速）
    preauth["resend_available_at"] = now + s.otp_resend_cooldown_seconds
    save_preauth(r, preauth_token, preauth)

    account_id = preauth["account_id"]
    with control_session() as session:
        account = account_repo.get_account(session, account_id)
        to_email = account.email if account else None
    if to_email:
        _send_otp_email(to_email, otp)
    return {"expires_in": s.otp_ttl_seconds, "resend_available_in": s.otp_resend_cooldown_seconds}


def logout_all(r: redis.Redis, token: str | None) -> None:
    """全端末ログアウト＋信頼端末失効（A.0-⑤＝全端末で次回 MFA 必須）。"""
    session_data = read_session(r, token) if token else None
    if session_data is None:
        raise AppError(401, "unauthenticated")
    account_id = session_data["account_id"]
    delete_account_sessions(r, account_id)
    with control_session() as session:
        account_repo.revoke_all_trusted_devices(session, account_id)
        session.commit()


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
        login_id = account.login_id
        # accounts 更新と同一Tx で会社DB users への password_set ミラーを outbox へ積む（§4.6・A.7）
        account_sync_repo.enqueue(
            session, account.id, account.company_id, "upsert", {"password_set": True}
        )
        session.commit()

    # PW 変更で当該アカウントの全セッションを破棄（A.9-③・ここでは新セッションは張らない）
    delete_account_sessions(r, account_id)
    # 本人がメール経由で PW 再設定＝到達の証拠。当該 login_id のログインロックを即解除（ADR-0005 §2.5(b)）
    clear_login_locks_for_login_id(r, login_id)


def _challenge_is_valid(challenge) -> bool:
    return (
        challenge is not None
        and challenge.used_at is None
        and challenge.expires_at > datetime.now(timezone.utc)
    )
