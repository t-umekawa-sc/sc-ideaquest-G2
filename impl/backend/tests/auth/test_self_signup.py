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


def _demo_company_id() -> uuid.UUID:
    with control_session() as s:
        return s.execute(select(Company).where(Company.company_code == "DEMO")).scalars().one().id


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
