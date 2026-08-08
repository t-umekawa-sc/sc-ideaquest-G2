"""ドメイン A ログインのテスト（doc/テスト/A_認証.md）。TC-ID を関数名/先頭に埋める。"""
from __future__ import annotations

from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

LOGIN = "/api/v1/auth/login"


def test_a_tc_001_login_success(client):
    """A-TC-001 正資格でログイン→200 authenticated＋Set-Cookie(iq_session,iq_csrf)。根拠 A.1/A.6。"""
    r = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "authenticated"
    session = body["session"]
    for key in ("account_id", "company_id", "company_code", "system_role", "locale", "user"):
        assert key in session
    assert session["company_code"] == SEED_COMPANY_CODE
    assert r.cookies.get("iq_session")
    assert r.cookies.get("iq_csrf")


def test_a_tc_002_wrong_password_401(client, factory):
    """A-TC-002 誤パスワード→401 unauthenticated・Cookie 無し。根拠 A.1（列挙耐性）。"""
    company = factory.make_company()
    account = factory.make_account(company, password="Correct1!")
    r = client.post(LOGIN, json={"company_code": company["company_code"], "login_id": account["login_id"], "password": "WRONG"})
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"
    assert r.cookies.get("iq_session") is None


def test_a_tc_003_unknown_login_id_401(client):
    """A-TC-003 存在しない login_id→401（002 と同一レスポンス）。根拠 A.1。"""
    r = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": "nobody@acme.example", "password": SEED_PASSWORD})
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"


def test_a_tc_004_unknown_company_code_401(client):
    """A-TC-004 存在しない company_code→401（同一）。根拠 A.1。"""
    r = client.post(LOGIN, json={"company_code": "NOPE-99", "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"


def test_a_tc_005_password_not_set_401(client, factory):
    """A-TC-005 password_set=false→401（password_setup_required を返さない）。根拠 A.1/SC-00 §5。"""
    company = factory.make_company()
    account = factory.make_account(company, password_set=False)
    r = client.post(LOGIN, json={"company_code": company["company_code"], "login_id": account["login_id"], "password": "anything"})
    assert r.status_code == 401
    body = r.json()
    assert body["code"] == "unauthenticated"
    assert "password_setup_required" not in body


def test_a_tc_006_suspended_company_correct_creds_503(client, factory):
    """A-TC-006 停止中会社＋正資格→503（資格照合成功の後に）。根拠 A.1/README §1.5。"""
    company = factory.make_company(status="suspended")
    account = factory.make_account(company, password="Correct1!")
    r = client.post(LOGIN, json={"company_code": company["company_code"], "login_id": account["login_id"], "password": "Correct1!"})
    assert r.status_code == 503
    assert r.json()["code"] == "company_suspended"


def test_a_tc_007_suspended_company_wrong_creds_401(client, factory):
    """A-TC-007 停止中会社＋誤資格→401（503 を返さない・列挙耐性）。根拠 A.1。"""
    company = factory.make_company(status="suspended")
    account = factory.make_account(company, password="Correct1!")
    r = client.post(LOGIN, json={"company_code": company["company_code"], "login_id": account["login_id"], "password": "WRONG"})
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"


def test_a_tc_008_missing_field_422(client):
    """A-TC-008 必須欠落→422 validation_error。根拠 README §1.7。"""
    r = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN})
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"


def test_a_tc_009_login_without_csrf_succeeds(client):
    """A-TC-009 login は CSRF 免除（X-CSRF-Token 無しでも成功）。根拠 A.0/A.1。"""
    r = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    assert r.status_code == 200


def test_a_tc_010_login_bad_origin_403(client):
    """A-TC-010 不正 Origin→403。根拠 A.0（Origin/Sec-Fetch 検証）。"""
    r = client.post(
        LOGIN,
        json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD},
        headers={"Origin": "http://evil.example"},
    )
    assert r.status_code == 403
    assert r.json()["code"] == "forbidden"


def test_a_tc_016_cookie_attributes(client):
    """A-TC-016 Cookie 属性: iq_session=httpOnly/SameSite=Lax, iq_csrf=非httpOnly。根拠 A.0/ADR §2.3。"""
    r = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    set_cookies = [h.lower() for h in r.headers.get_list("set-cookie")]
    sess = next(h for h in set_cookies if h.startswith("iq_session="))
    csrf = next(h for h in set_cookies if h.startswith("iq_csrf="))
    assert "httponly" in sess
    assert "samesite=lax" in sess
    assert "httponly" not in csrf
    assert "samesite=lax" in csrf


def test_a_tc_017_session_fixation_new_id(client):
    """A-TC-017 認証成功のたびに新しいセッションID（固定化対策）。根拠 A.0。"""
    r1 = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    token1 = r1.cookies.get("iq_session")
    r2 = client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    token2 = r2.cookies.get("iq_session")
    assert token1 and token2 and token1 != token2
