"""GET /auth/session のテスト（doc/テスト/A_認証.md）。"""
from __future__ import annotations

from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

LOGIN = "/api/v1/auth/login"
SESSION = "/api/v1/auth/session"


def test_a_tc_011_get_session_ok(client):
    """A-TC-011 有効セッションで GET /session→200＋A.6 スキーマ。根拠 A.1/A.6。"""
    client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    r = client.get(SESSION)
    assert r.status_code == 200
    body = r.json()
    for key in ("account_id", "company_id", "company_code", "system_role", "locale", "user"):
        assert key in body
    assert "created_at" not in body  # 内部フィールドを漏らさない（A.6 のみ）


def test_a_tc_012_get_session_no_session_401(client):
    """A-TC-012 セッション無しで GET /session→401。根拠 A.1。"""
    r = client.get(SESSION)
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"
