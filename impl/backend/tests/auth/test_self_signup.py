"""セルフサインアップ（FR-48②・API A.11.2-A.11.4・設計 §8.2/§8.4）の公開（未認証）EP。

bootstrap/signup/verify。列挙耐性（一律202・SEC B）・検証前に accounts を作らない（決定A）・
確定で初めて INSERT（SEC E・単回・SEC I=自動ログインしない）を検証する。
会社は bootstrap seed の DEMO（access_mode=public・self_signup_enabled=true）を使う。
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account, Company, SignupChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.core.config import get_settings
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.cache import get_redis
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User

BOOTSTRAP = "/api/v1/public/bootstrap"
SIGNUP = "/api/v1/public/signup"
VERIFY = "/api/v1/public/signup/verify"


def _uniq_email() -> str:
    return f"signup-{uuid.uuid4().hex[:12]}@demo.example"


def _cleanup_email(email: str) -> None:
    """共有dev DB を汚さないよう、テストが作った pending/account/outbox を物理削除（冪等化）。"""
    with control_session() as s:
        acc = s.execute(select(Account).where(Account.email == email)).scalars().one_or_none()
        if acc is not None:
            s.execute(OutboxEntry.__table__.delete().where(OutboxEntry.account_id == acc.id))
        s.execute(SignupChallenge.__table__.delete().where(SignupChallenge.email == email))
        s.execute(MailOutboxEntry.__table__.delete().where(MailOutboxEntry.to_email == email))
        s.execute(Account.__table__.delete().where(Account.email == email))
        s.commit()


def _latest_signup_code(email: str) -> str | None:
    """mail_outbox の signup_verify の secret（=6桁OTP）を取り出す（テストで検証に使う）。"""
    with control_session() as s:
        row = s.execute(
            select(MailOutboxEntry).where(
                MailOutboxEntry.to_email == email, MailOutboxEntry.category == "signup_verify"
            ).order_by(MailOutboxEntry.seq.desc()).limit(1)
        ).scalars().one_or_none()
        return row.secret if row else None


def _account_count(email: str) -> int:
    with control_session() as s:
        return s.execute(select(func.count()).select_from(Account).where(Account.email == email)).scalar_one()


def _pending_for(email: str) -> SignupChallenge | None:
    with control_session() as s:
        return s.execute(select(SignupChallenge).where(SignupChallenge.email == email)).scalars().one_or_none()


def _account_for(email: str) -> Account | None:
    with control_session() as s:
        return s.execute(select(Account).where(Account.email == email)).scalars().one_or_none()


def _demo_company() -> Company:
    with control_session() as s:
        return s.execute(select(Company).where(Company.company_code == "DEMO")).scalars().one()


def _demo_company_id() -> uuid.UUID:
    return _demo_company().id


def _demo_admin_user_id() -> uuid.UUID:
    """DEMO 会社の運営 admin@demo.example の会社DB user id（通知の受信者）。"""
    demo = _demo_company()
    with control_session() as s:
        acc = s.execute(select(Account).where(Account.login_id == "admin@demo.example")).scalars().one()
    with get_tenant_session(demo.db_identifier) as ts:
        return ts.execute(select(User).where(User.account_id == acc.id)).scalars().one().id


def _signup_registered_count(admin_user_id: uuid.UUID) -> int:
    demo = _demo_company()
    with get_tenant_session(demo.db_identifier) as ts:
        return ts.execute(
            select(func.count()).select_from(Notification).where(
                Notification.recipient_id == admin_user_id, Notification.type == "signup_registered"
            )
        ).scalar_one()


def _clear_signup_notifs(admin_user_id: uuid.UUID) -> None:
    demo = _demo_company()
    with get_tenant_session(demo.db_identifier) as ts:
        ts.execute(Notification.__table__.delete().where(
            Notification.recipient_id == admin_user_id, Notification.type == "signup_registered"
        ))
        ts.commit()


def _signup_and_verify(client) -> str:
    """フル signup→verify（コードは mail_outbox.secret）＝accounts 確定。確定した email を返す。"""
    email = _uniq_email()
    assert client.post(SIGNUP, json={
        "company_code": "DEMO", "login_id": email, "email": email,
        "display_name": "通知テスト", "password": "Str0ng-Uniq-9x!",
    }).status_code == 202
    code = _latest_signup_code(email)
    assert client.post(VERIFY, json={"company_code": "DEMO", "email": email, "code": code}).status_code == 200
    return email


def test_a_tc_120_bootstrap_default_company_code(client, monkeypatch):
    """A-TC-120: 既定会社コードの有無で出し分け（未設定=null／設定=コード＋self_signup可否）。"""
    s = get_settings()
    # 未設定（通常デプロイ）＝会社コード欄を出す＝null・self_signup_available=false。
    monkeypatch.setattr(s, "default_company_code", "")
    r = client.get(BOOTSTRAP)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["default_company_code"] is None
    assert body["self_signup_available"] is False

    # 既定会社コード=DEMO（seed 済み public＋self_signup_enabled）＝コードを返し self_signup_available=true。
    monkeypatch.setattr(s, "default_company_code", "DEMO")
    r = client.get(BOOTSTRAP)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["default_company_code"] == "DEMO"
    assert body["self_signup_available"] is True


def test_a_tc_121_signup_creates_pending_not_account(client):
    """A-TC-121: 検証前に accounts を作らない（SEC A）＝202・pending のみ・PW は Argon2id。"""
    email = _uniq_email()
    try:
        r = client.post(SIGNUP, json={
            "company_code": "DEMO", "login_id": email, "email": email,
            "display_name": "サインアップ太郎", "password": "Passw0rd!",
        })
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["status"] == "verification_sent" and "@" in body["masked_to"]
        # accounts は未作成（決定A）。pending は 1件・PW は平文保持しない（Argon2id）。
        assert _account_for(email) is None
        pending = _pending_for(email)
        assert pending is not None and pending.used_at is None
        assert pending.password_hash != "Passw0rd!" and pending.password_hash.startswith("$argon2")
    finally:
        _cleanup_email(email)


def test_a_tc_123_enumeration_uniform_202(client):
    """A-TC-123: 列挙耐性（SEC B）＝既存 email も非対象会社コードも一律 202（成功と区別不能）。"""
    # 既存アカウント（DEMO 運営 admin@demo.example）宛でも 202・pending は作らない（out-of-band 通知）。
    r = client.post(SIGNUP, json={
        "company_code": "DEMO", "login_id": "admin@demo.example", "email": "admin@demo.example",
        "display_name": "x", "password": "Passw0rd!",
    })
    assert r.status_code == 202, r.text
    assert _pending_for("admin@demo.example") is None  # 既存は pending 作らない
    # 存在しない会社コードでも 202（区別不能）。
    email = _uniq_email()
    try:
        r = client.post(SIGNUP, json={
            "company_code": "NOPE-XYZ", "login_id": email, "email": email,
            "display_name": "x", "password": "Passw0rd!",
        })
        assert r.status_code == 202, r.text
        assert _pending_for(email) is None  # 非対象会社は pending 作らない
    finally:
        _cleanup_email(email)


def test_a_tc_124_disabled_company_uniform_reject(client):
    """A-TC-124/126: self_signup_enabled=false の会社（ACME-01）は一律 reject（202・pending なし・SEC F/決定M）。"""
    email = _uniq_email()
    try:
        r = client.post(SIGNUP, json={
            "company_code": "ACME-01", "login_id": email, "email": email,
            "display_name": "x", "password": "Passw0rd!",
        })
        assert r.status_code == 202, r.text          # 列挙耐性＝一律 202
        assert _pending_for(email) is None           # だが pending は作られない（private 会社への勝手登録を防止）
    finally:
        _cleanup_email(email)


def test_a_tc_130_password_min_length_422(client):
    """A-TC-130: PW 最低文字数の形式検証は 422（SEC D）。会社存在/重複は 422 にしない（列挙耐性）。"""
    email = _uniq_email()
    r = client.post(SIGNUP, json={
        "company_code": "DEMO", "login_id": email, "email": email,
        "display_name": "x", "password": "short",
    })
    assert r.status_code == 422, r.text


def test_a_tc_131_pwned_password_rejected(client, monkeypatch):
    """A-TC-131: 漏洩PW拒否（SEC D・HIBP・env-gated）＝漏洩は422 field=password・非漏洩は202・pending作らない。"""
    import app.control_plane.public.application as app_mod
    # HIBP を Fake（外部未接続）＝特定PWだけ漏洩扱い。
    monkeypatch.setattr(app_mod, "is_pwned_password", lambda pw: pw == "Passw0rd!")
    email = _uniq_email()
    r = client.post(SIGNUP, json={
        "company_code": "DEMO", "login_id": email, "email": email,
        "display_name": "x", "password": "Passw0rd!",
    })
    assert r.status_code == 422, r.text
    assert any(e.get("field") == "password" for e in (r.json().get("errors") or []))
    assert _pending_for(email) is None  # 漏洩PW は pending を作らない
    # 非漏洩PW は通常どおり 202。
    email2 = _uniq_email()
    try:
        r2 = client.post(SIGNUP, json={
            "company_code": "DEMO", "login_id": email2, "email": email2,
            "display_name": "x", "password": "Str0ng-Uniq-9x!",
        })
        assert r2.status_code == 202, r2.text
    finally:
        _cleanup_email(email2)


def test_a_tc_132_disposable_email_rejected(client):
    """A-TC-132: 使い捨てメールドメイン拒否（SEC G・ローカル blocklist）＝422 field=email・pending作らない。"""
    email = f"throwaway-{uuid.uuid4().hex[:8]}@mailinator.com"  # 同梱 blocklist のドメイン
    r = client.post(SIGNUP, json={
        "company_code": "DEMO", "login_id": email, "email": email,
        "display_name": "x", "password": "Str0ng-Uniq-9x!",
    })
    assert r.status_code == 422, r.text
    assert any(e.get("field") == "email" for e in (r.json().get("errors") or []))
    assert _pending_for(email) is None


def test_a_tc_133_admin_signup_notify_cooldown(client, monkeypatch):
    """A-TC-133: 新規登録の管理者通知（SEC H）＝初回は即送・クールダウン中はカウントのみ（まとめ件数）。"""
    s = get_settings()
    monkeypatch.setattr(s, "signup_admin_notify_enabled", True)
    demo_id = _demo_company_id()
    r = get_redis()
    cd_key, pend_key = f"signup_notify_cd:{demo_id}", f"signup_notify_pending:{demo_id}"
    r.delete(cd_key); r.delete(pend_key)  # 前回 run の残留を除去（冪等）
    admin = _demo_admin_user_id()
    _clear_signup_notifs(admin)
    before = _signup_registered_count(admin)
    e1 = _signup_and_verify(client)  # 1通目＝即送
    e2 = _signup_and_verify(client)  # 2通目＝クールダウン中＝カウントのみ
    try:
        assert _signup_registered_count(admin) - before == 1   # 通知は1件だけ（ダイジェスト化）
        assert int(r.get(pend_key) or 0) == 1                  # 2通目は pending に積まれる
    finally:
        _cleanup_email(e1); _cleanup_email(e2)
        _clear_signup_notifs(admin)
        r.delete(cd_key); r.delete(pend_key)


def test_a_tc_134_captcha_turnstile(client, monkeypatch):
    """A-TC-134: CAPTCHA（Turnstile・env-gated）＝検証失敗で400・成功で202・未設定はスキップ（既存テストで担保）。"""
    import app.control_plane.public.application as app_mod
    # 有効化相当＝verify_turnstile を Fake（外部 siteverify を叩かない）。
    monkeypatch.setattr(app_mod, "verify_turnstile", lambda token, ip: token == "good-token")
    bad = _uniq_email()
    r = client.post(SIGNUP, json={
        "company_code": "DEMO", "login_id": bad, "email": bad,
        "display_name": "x", "password": "Str0ng-Uniq-9x!", "captcha_token": "bad",
    })
    assert r.status_code == 400, r.text
    assert r.json().get("code") == "captcha_failed"
    assert _pending_for(bad) is None  # ボット判定失敗は pending を作らない
    good = _uniq_email()
    try:
        r2 = client.post(SIGNUP, json={
            "company_code": "DEMO", "login_id": good, "email": good,
            "display_name": "x", "password": "Str0ng-Uniq-9x!", "captcha_token": "good-token",
        })
        assert r2.status_code == 202, r2.text
    finally:
        _cleanup_email(good)


def test_a_tc_122_verify_creates_account_server_authoritative(client):
    """A-TC-122/128: 検証成功で初めて accounts INSERT（SEC E 権威）＋自動ログインしない（SEC I）。"""
    email = _uniq_email()
    try:
        r = client.post(SIGNUP, json={
            "company_code": "DEMO", "login_id": email, "email": email,
            "display_name": "確定 花子", "password": "Passw0rd!",
        })
        assert r.status_code == 202, r.text
        code = _latest_signup_code(email)
        assert code is not None and len(code) == 6
        r = client.post(VERIFY, json={"company_code": "DEMO", "email": email, "code": code})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "created" and body["login_id"] == email and body["company_code"] == "DEMO"
        # SEC I＝自動ログインしない＝セッション Cookie を発行しない。
        assert "iq_session" not in r.cookies
        # SEC E＝サーバー権威（role=general・active・email_verified・company=DEMO）。
        acc = _account_for(email)
        assert acc is not None and acc.system_role == "general" and acc.status == "active"
        assert acc.email_verified_at is not None and acc.company_id == _demo_company_id()
        assert acc.password_hash and acc.password_hash.startswith("$argon2")
        # pending は単回（used_at 打刻）。
        assert _pending_for(email).used_at is not None
    finally:
        _cleanup_email(email)


def test_a_tc_129_verify_single_use_410(client):
    """A-TC-129: pending は単回＝確定後に同コードで再検証すると 410・二重 accounts を作らない（SEC A/C）。"""
    email = _uniq_email()
    try:
        r = client.post(SIGNUP, json={
            "company_code": "DEMO", "login_id": email, "email": email,
            "display_name": "x", "password": "Passw0rd!",
        })
        assert r.status_code == 202, r.text
        code = _latest_signup_code(email)
        assert client.post(VERIFY, json={"company_code": "DEMO", "email": email, "code": code}).status_code == 200
        # 再利用＝410（使用済み）・accounts は1件のまま（二重作成しない）。
        r2 = client.post(VERIFY, json={"company_code": "DEMO", "email": email, "code": code})
        assert r2.status_code == 410, r2.text
        assert _account_count(email) == 1
    finally:
        _cleanup_email(email)


def test_a_tc_verify_wrong_code_invalid(client):
    """誤コードは汎用失敗（400 invalid_code・SEC C 定数時間比較）＝accounts を作らない。"""
    email = _uniq_email()
    try:
        assert client.post(SIGNUP, json={
            "company_code": "DEMO", "login_id": email, "email": email,
            "display_name": "x", "password": "Passw0rd!",
        }).status_code == 202
        r = client.post(VERIFY, json={"company_code": "DEMO", "email": email, "code": "000000"})
        assert r.status_code == 400, r.text
        assert _account_for(email) is None
    finally:
        _cleanup_email(email)
