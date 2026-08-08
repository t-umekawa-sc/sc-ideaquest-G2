"""POST /auth/logout のテスト（doc/テスト/A_認証.md）。認証と CSRF の評価順序を対で確認。"""
from __future__ import annotations

from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

LOGIN = "/api/v1/auth/login"
SESSION = "/api/v1/auth/session"
LOGOUT = "/api/v1/auth/logout"


def _login(client):
    client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})


def test_a_tc_013_logout_ok(client):
    """A-TC-013 有効セッション＋CSRF一致で logout→204、以後 session は 401。根拠 A.1。"""
    _login(client)
    csrf = client.cookies.get("iq_csrf")
    r = client.post(LOGOUT, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 204
    assert client.get(SESSION).status_code == 401


def test_a_tc_014_logout_without_csrf_403(client):
    """A-TC-014 セッション有り・CSRF 無し→403 csrf_failed（セッションは維持）。根拠 A.0/§1.7。"""
    _login(client)
    r = client.post(LOGOUT)  # X-CSRF-Token を付けない
    assert r.status_code == 403
    assert r.json()["code"] == "csrf_failed"
    assert client.get(SESSION).status_code == 200  # まだ有効


def test_a_tc_015_logout_no_session_401(client):
    """A-TC-015 セッション無しで logout→401（認証を CSRF より先に評価・014 の 403 と対）。根拠 A.1。"""
    r = client.post(LOGOUT)
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"
