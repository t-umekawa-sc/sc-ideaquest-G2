"""A-TC-111〜115: 認証イベントの監査ログ（A.9-⑥）。

system_audit_logs に「操作者/IP・UA/対象/結果」を記録し、PW/OTP/セッションID/各種トークンは含めない。
基盤＝AuditContextMiddleware が actor/IP/UA を自動付与。既存＝new_device/password_changed。本ファイルは欠落分。
"""
from __future__ import annotations

import re

from fastapi.testclient import TestClient

from app.db.control import control_session
from app.main import app

LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
LOGOUT_ALL = "/api/v1/auth/logout-all"
VERIFY = "/api/v1/auth/mfa/verify"
REQUEST = "/api/v1/auth/password-setup/request"


def _audit(action: str, *, account_id=None, login_id=None) -> list[dict]:
    from app.control_plane.audit.orm import SystemAuditLog
    with control_session() as s:
        rows = s.query(SystemAuditLog).filter_by(action=action).all()
        out = []
        for r in rows:
            d = r.detail or {}
            if account_id is not None and d.get("account_id") != str(account_id):
                continue
            if login_id is not None and d.get("login_id") != login_id:
                continue
            out.append({"detail": d, "ip": r.ip, "user_agent": r.user_agent})
        return out


def _no_secrets(detail: dict) -> None:
    """機密（PW/生OTP/セッションID/各種トークン）が detail に載っていないこと（§15）。

    reason コード（`otp_invalid` 等）は機密でないので、キー名と『生 OTP らしい値（6桁）』で判定する
    （部分文字列 "otp" では誤検知するため）。
    """
    forbidden_keys = {"password", "otp", "otp_hash", "token", "secret", "hash", "session", "session_id"}
    assert not (set(detail) & forbidden_keys), f"secret key in audit detail: {detail}"
    for v in detail.values():
        assert not re.fullmatch(r"\d{6}", str(v)), f"otp-like value leaked: {detail}"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _otp_from_mail(mail) -> str:
    m = re.search(r"認証コード:\s*(\d{6})", mail.sent[-1].body)
    assert m, mail.sent[-1].body
    return m.group(1)


def test_a_tc_111_login_success_audited(client, factory):
    """A-TC-111 ログイン成功を `auth.login.success` で記録（IP 付き・mfa=false・機密なし）。"""
    acc = factory.make_seed_company_account()  # seed 会社＝テナントDB 有（成功ログインで解決される）
    r = client.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"]})
    assert r.status_code == 200, r.text
    rows = _audit("auth.login.success", account_id=acc["id"])
    assert len(rows) >= 1
    assert rows[-1]["detail"].get("mfa") is False
    assert rows[-1]["ip"]  # IP を記録している
    _no_secrets(rows[-1]["detail"])


def test_a_tc_112_login_failure_and_lock_audited(client, factory):
    """A-TC-112 失敗を `auth.login.failure`・上限(5)で `auth.account_locked` を記録（PW を含まない）。"""
    company = factory.make_company()
    acc = factory.make_account(company, password="Correct1!")
    cl = TestClient(app, client=("203.0.113.77", 12345))  # ロックは (IP+login_id) 単位＝専用 IP で隔離
    for _ in range(5):
        cl.post(LOGIN, json={"company_code": company["company_code"], "login_id": acc["login_id"], "password": "WRONG"})
    fails = _audit("auth.login.failure", login_id=acc["login_id"])
    assert len(fails) >= 5
    _no_secrets(fails[-1]["detail"])
    assert len(_audit("auth.account_locked", login_id=acc["login_id"])) >= 1


def test_a_tc_113_mfa_issue_and_verify_audited(client, factory, mail):
    """A-TC-113 MFA 発行 `auth.mfa.issued`・検証 `auth.mfa.verify`(failure→success)＋`auth.login.success`(mfa=true)。OTP なし。"""
    acc = factory.make_seed_mfa_account()  # ACME-02＝MFA 必須の seed 会社（テナントDB 有）
    r = client.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"]})
    assert r.json()["status"] == "mfa_required"
    issued = _audit("auth.mfa.issued", account_id=acc["id"])
    assert len(issued) >= 1
    _no_secrets(issued[-1]["detail"])
    client.post(VERIFY, json={"code": "000000"}, headers=_csrf(client))  # 誤コード
    assert any(v["detail"].get("result") == "failure" for v in _audit("auth.mfa.verify", account_id=acc["id"]))
    otp = _otp_from_mail(mail)
    r2 = client.post(VERIFY, json={"code": otp}, headers=_csrf(client))  # 正コード
    assert r2.status_code == 200, r2.text
    verifies = _audit("auth.mfa.verify", account_id=acc["id"])
    assert any(v["detail"].get("result") == "success" for v in verifies)
    for v in verifies:
        _no_secrets(v["detail"])
    assert any(x["detail"].get("mfa") is True for x in _audit("auth.login.success", account_id=acc["id"]))


def test_a_tc_114_logout_and_logout_all_audited(client, factory):
    """A-TC-114 `auth.logout` / `auth.logout_all` を account_id 付きで記録。"""
    acc = factory.make_seed_company_account()  # seed 会社＝テナントDB 有（成功ログイン）
    creds = {"company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"]}
    client.post(LOGIN, json=creds)
    client.post(LOGOUT, headers=_csrf(client))
    assert len(_audit("auth.logout", account_id=acc["id"])) >= 1
    client.post(LOGIN, json=creds)
    client.post(LOGOUT_ALL, headers=_csrf(client))
    assert len(_audit("auth.logout_all", account_id=acc["id"])) >= 1


def test_a_tc_115_self_service_reset_request_audited(client, factory):
    """A-TC-115 自己サービス PW 再設定リクエストを `auth.password_setup.request`(origin=self_service) で記録（管理者起点と区別・token なし）。"""
    company = factory.make_company()
    acc = factory.make_account(company)
    r = client.post(REQUEST, json={"company_code": company["company_code"], "login_id": acc["login_id"]})
    assert r.status_code == 202, r.text
    rows = _audit("auth.password_setup.request", account_id=acc["id"])
    assert len(rows) >= 1
    assert rows[-1]["detail"].get("origin") == "self_service"
    _no_secrets(rows[-1]["detail"])
