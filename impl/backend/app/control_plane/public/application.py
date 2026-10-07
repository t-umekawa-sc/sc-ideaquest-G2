"""公開プレーン（セルフサインアップ）のユースケース（API設計 A §A.11.2-A.11.4・設計 §8.2/§8.4）。

SEC: 列挙耐性（一律 202・SEC B）／検証前に accounts を作らない（決定A・pending=signup_challenges）／
PW 即 Argon2id（SEC D）／会社コード再検証（SEC F）／確定後は自動ログインしない（SEC I）。
"""
from __future__ import annotations

import hmac
import uuid
from datetime import datetime, timedelta, timezone

import redis
from sqlalchemy import select

from app.control_plane.account_sync import repository as account_sync_repo
from app.control_plane.audit import repository as audit
from app.control_plane.auth.domain.service import mask_email
from app.control_plane.auth.orm import Account
from app.control_plane.mail_outbox import repository as mail_repo
from app.control_plane.mail_outbox.templates import CATEGORY_SIGNUP_EXISTING, CATEGORY_SIGNUP_VERIFY
from app.control_plane.public import repository as repo
from app.core.captcha import verify_turnstile
from app.core.config import get_settings
from app.core.disposable_email import is_disposable
from app.core.errors import AppError
from app.core.pwned import is_pwned_password
from app.core.security import generate_otp, hash_password, hash_token, within_signup_rate_limit
from app.db.control import control_session
from app.infra.cache import get_redis
from app.tenant.notifications import service as notify_svc
from app.tenant.profile.orm import User


def _normalize_code(company_code: str | None) -> str:
    """会社コードは大文字正規化（SC-00/ログインと同じ）。既定会社コード（env）で補完する前段。"""
    s = get_settings()
    code = (company_code or s.default_company_code or "").strip().upper()
    return code


def bootstrap() -> dict:
    """公開ブートストラップ（A.11.2・決定L）＝デプロイ既定会社コードの有無と self_signup 可否。

    既定会社コード（env IQ_DEFAULT_COMPANY_CODE）が無ければ `{None, False}`（通常デプロイ＝会社コード欄を出す）。
    有れば会社を引き、active かつ `self_signup_enabled=true` の時だけ `self_signup_available=true`。
    会社の存在は既定コードが設定された public デプロイでのみ返す（通常デプロイでは会社を明かさない・SEC B）。
    """
    s = get_settings()
    site_key = s.turnstile_site_key or None  # CAPTCHA 未設定は null（既定会社の有無に関わらず返す）
    code = (s.default_company_code or "").strip().upper()
    if not code:
        return {"default_company_code": None, "self_signup_available": False, "turnstile_site_key": site_key}
    with control_session() as session:
        company = repo.get_company_by_code(session, code)
    available = bool(company and company.status == "active" and company.self_signup_enabled)
    return {"default_company_code": code, "self_signup_available": available, "turnstile_site_key": site_key}


def signup(
    r: redis.Redis, client_ip: str, *, company_code: str | None,
    login_id: str, email: str, display_name: str, password: str,
    captcha_token: str | None = None,
) -> dict:
    """セルフサインアップ要求（A.11.3）＝一律 202（SEC B）・検証前に accounts を作らない（決定A）。

    内部条件（会社 active＋self_signup_enabled・email 未登録・レート制限内）を満たす時だけ pending 作成＋
    6桁OTP 送信。満たさない場合も同一の 202 を返す（成功と区別不能＝列挙耐性）。既存 email は out-of-band 通知。
    """
    s = get_settings()
    code = _normalize_code(company_code)
    # SEC G＝CAPTCHA（Turnstile・env-gated）＝ボット遮断を最優先で先頭に。未設定時は常に通過（スキップ）。
    if not verify_turnstile(captcha_token, client_ip):
        raise AppError(400, "captcha_failed", detail="ボット対策の確認に失敗しました。もう一度お試しください。")
    # SEC G＝使い捨てメールドメイン拒否（ローカル blocklist）。email 形式検証と同種＝422。
    if is_disposable(email):
        raise AppError(422, "validation_error", errors=[{
            "field": "email",
            "message": "このメールアドレスのドメインは利用できません。別のアドレスをご利用ください。",
        }])
    # SEC D＝漏洩PW拒否（HIBP・env-gated）。PW品質は会社/列挙と独立＝422 で明示（format 検証と同種）。
    if is_pwned_password(password):
        raise AppError(422, "validation_error", errors=[{
            "field": "password",
            "message": "このパスワードは漏洩が確認されています。別のパスワードを設定してください。",
        }])
    accepted = {
        "status": "verification_sent", "masked_to": mask_email(email),
        "expires_in": s.otp_ttl_seconds, "resend_available_in": s.otp_resend_cooldown_seconds,
    }
    # SEC C/G＝レート制限（超過でも 202 維持・作成/送信をスキップ）。
    if not within_signup_rate_limit(r, client_ip, code, email):
        return accepted
    if not code:
        return accepted
    with control_session() as session:
        company = repo.get_company_by_code(session, code)
        # SEC F＝会社の存在＋active＋self_signup_enabled を再検証（否は一律 reject＝private 会社への勝手登録を防止）。
        if company is None or company.status != "active" or not company.self_signup_enabled:
            return accepted
        # SEC B＝既存 account は in-band で明かさず out-of-band 通知（pending は作らない）。
        if repo.account_exists(session, company.id, login_id=login_id, email=email):
            mail_repo.enqueue(session, to_email=email, category=CATEGORY_SIGNUP_EXISTING,
                              company_id=company.id)
            audit.record("signup.request", {"company_code": code, "result": "existing"}, session=session)
            session.commit()
            return accepted
        # 検証前 pending を保持（SEC A・PW 即 Argon2id・SEC D／6桁OTP の SHA-256・SEC C・10分単回）。
        otp = generate_otp(s.otp_length)
        expires = datetime.now(timezone.utc) + timedelta(seconds=s.otp_ttl_seconds)
        repo.replace_pending(
            session, company_id=company.id, login_id=login_id, email=email,
            display_name=display_name, password_hash=hash_password(password),
            code_hash=hash_token(otp), expires_at=expires,
        )
        mail_repo.enqueue(session, to_email=email, category=CATEGORY_SIGNUP_VERIFY,
                          secret=otp, company_id=company.id, params={"expires_in": s.otp_ttl_seconds})
        audit.record("signup.request", {"company_code": code, "result": "pending"}, session=session)
        session.commit()
    return accepted


def _notify_admins_signup(company_id: uuid.UUID, display_name: str) -> None:
    """新規登録を会社の `company_account_admin` へ通知（SEC H・env-gated・best-effort・post-commit）。

    クールダウン外なら即送（溜まった pending をまとめて「ほか N 件」）。クールダウン中はカウントのみ＝
    通知爆撃（サインアップ爆撃）を防ぐダイジェスト化。無効設定時は何もしない。
    """
    s = get_settings()
    if not s.signup_admin_notify_enabled:
        return
    r = get_redis()
    cooldown_key = f"signup_notify_cd:{company_id}"
    pending_key = f"signup_notify_pending:{company_id}"
    if r.set(cooldown_key, "1", nx=True, ex=s.signup_admin_notify_cooldown_seconds):
        raw = r.get(pending_key)
        if raw is not None:
            r.delete(pending_key)
        extra = int(raw or 0)

        def _build(ts):
            admins = ts.execute(
                select(User.id).where(User.system_role == "company_account_admin")
            ).scalars().all()
            params = {"display_name": display_name, "extra_count": extra}
            return [notify_svc.entry(uid, "signup_registered", params=params) for uid in admins]

        notify_svc.dispatch(company_id, _build)  # 別セッション・例外握り潰し（best-effort）
    else:
        r.incr(pending_key)


def verify(*, company_code: str | None, email: str, code: str) -> dict:
    """認証コード検証 → アカウント確定（A.11.3・決定A/N・SEC E/I）。

    検証成功で**初めて** `accounts` を INSERT（role/company/status はサーバー権威・SEC E）＋会社DBミラー。
    単回（used_at 打刻・再利用は 410・SEC A/C）。**自動ログインしない**（セッション発行なし・SEC I）＝
    確定後は SC-00 ログインへ誘導。一意性先約は in-band で明かさず out-of-band 通知＋汎用失敗（SEC B）。
    """
    s = get_settings()
    ccode = _normalize_code(company_code)
    invalid = AppError(400, "invalid_code", detail="認証コードが正しくありません。")  # 汎用失敗（存在秘匿）
    if not ccode:
        raise invalid
    with control_session() as session:
        company = repo.get_company_by_code(session, ccode)
        if company is None:
            raise invalid
        pending = repo.find_latest_pending(session, company_id=company.id, email=email)
        if pending is None:
            raise invalid
        now = datetime.now(timezone.utc)
        if pending.used_at is not None:
            raise AppError(410, "used", detail="この認証コードは使用済みです。")  # 単回（SEC A/C）
        if pending.expires_at <= now:
            raise AppError(410, "expired", detail="認証コードの有効期限が切れています。")
        if pending.attempts >= s.otp_max_attempts:
            raise AppError(410, "locked", detail="試行回数の上限に達しました。最初からやり直してください。")
        # 定数時間比較（SEC C）。不一致は試行加算して汎用失敗。
        if not hmac.compare_digest(pending.code_hash, hash_token(code)):
            pending.attempts += 1
            session.commit()
            raise invalid
        # 成功＝確定。一意性先約は in-band で明かさず out-of-band 通知＋used 打刻＋汎用失敗（SEC B・二重作成防止）。
        if repo.account_exists(session, company.id, login_id=pending.login_id, email=pending.email):
            mail_repo.enqueue(session, to_email=pending.email, category=CATEGORY_SIGNUP_EXISTING,
                              company_id=company.id)
            pending.used_at = now
            session.commit()
            raise invalid
        # SEC E＝サーバー権威で作成（role=general・company_id=解決値・status=active・email_verified）。
        account = Account(
            id=uuid.uuid4(), company_id=company.id,
            login_id=pending.login_id, email=pending.email, display_name=pending.display_name,
            password_hash=pending.password_hash,  # 既に Argon2id（signup 時）
            locale="ja", system_role="general", status="active", email_verified_at=now,
        )
        session.add(account)
        session.flush()
        pending.used_at = now  # 単回（SEC A/C）
        # 会社DB users ミラー（初回生成・password_set=True）＝同一Tx で outbox（§4.6）。
        account_sync_repo.enqueue(session, account.id, company.id, "upsert", {
            "display_name": pending.display_name, "login_id": pending.login_id, "email": pending.email,
            "status": "active", "password_set": True, "system_role": "general", "locale": "ja",
        })
        audit.record("signup.verify", {  # 監査（SEC J・機密は入れない）
            "company_code": ccode, "account_id": str(account.id), "result": "created",
        }, session=session)
        session.commit()
        login_id = pending.login_id
        notify_company_id = company.id
        notify_display_name = pending.display_name
    # 新規登録を管理者へ通知（SEC H・env-gated・post-commit・best-effort＝本処理成功を優先）。
    _notify_admins_signup(notify_company_id, notify_display_name)
    # 自動ログインしない（SEC I）＝セッション Cookie を発行せず、SC-00 ログインへ会社コード/ログインID をプリフィル誘導。
    return {"status": "created", "company_code": ccode, "login_id": login_id}
