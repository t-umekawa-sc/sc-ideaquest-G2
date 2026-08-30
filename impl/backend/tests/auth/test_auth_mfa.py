"""ドメイン A 状態C（メールOTP MFA）のテスト（doc/テスト/A_認証.md §4・ADR-0004）。

pre-auth/OTP は Redis、信頼端末は DB（trusted_devices）。OTP は mail フェイクの本文から取り出す。
"""
from __future__ import annotations

import re

from app.core.security import read_preauth, save_preauth
from app.infra.cache import get_redis

LOGIN = "/api/v1/auth/login"
VERIFY = "/api/v1/auth/mfa/verify"
RESEND = "/api/v1/auth/mfa/resend"
LOGOUT_ALL = "/api/v1/auth/logout-all"
SESSION = "/api/v1/auth/session"


def _otp_from_mail(mail) -> str:
    """OTP メール本文から6桁コードを抽出（`認証コード: 123456`）。"""
    body = mail.sent[-1].body
    m = re.search(r"認証コード:\s*(\d{6})", body)
    assert m, f"OTP not found in mail body: {body!r}"
    return m.group(1)


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_mfa(client, mfa, company_code, login_id, password="Passw0rd!"):
    """login して mfa_required 応答（pre-auth 発行）まで進める。"""
    r = client.post(LOGIN, json={"company_code": company_code, "login_id": login_id, "password": password})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "mfa_required"
    return r


# --- login mfa_required 分岐 -----------------------------------------------------------
def test_a_tc_060_login_mfa_required(client, factory, mail):
    """A-TC-060 MFA必須会社で正資格→200 mfa_required＋iq_preauth/iq_csrf・iq_session無し・OTPメール送信。A.1/ADR-0004。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    r = client.post(LOGIN, json={"company_code": company["company_code"], "login_id": account["login_id"], "password": account["password"]})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "mfa_required"
    mfa_obj = body["mfa"]
    assert mfa_obj["delivery"] == "email"
    assert "****" in mfa_obj["masked_to"]
    assert mfa_obj["expires_in"] == 600
    assert mfa_obj["resend_available_in"] == 30
    assert r.cookies.get("iq_preauth")
    assert r.cookies.get("iq_csrf")
    assert r.cookies.get("iq_session") is None
    assert len(mail.sent) == 1  # OTP を送っている


def test_a_tc_061_verify_wrong_code_attempts_left(client, factory, mail):
    """A-TC-061 OTP 誤り→401 otp_invalid＋attempts_left が減る。A.1/ADR-0004 §2.4。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    _login_mfa(client, mail, company["company_code"], account["login_id"])
    r = client.post(VERIFY, json={"code": "000000"}, headers=_csrf(client))
    assert r.status_code == 401
    body = r.json()
    assert body["code"] == "otp_invalid"
    assert body["attempts_left"] == 4  # 上限5・1回失敗


def test_a_tc_062_verify_exceed_max_invalidates_preauth(client, factory, mail):
    """A-TC-062 連続失敗が上限(5)に達すると pre-auth 失効→以後 preauth_expired。A.0-④。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    _login_mfa(client, mail, company["company_code"], account["login_id"])
    last = None
    for _ in range(5):
        last = client.post(VERIFY, json={"code": "000000"}, headers=_csrf(client))
    assert last.status_code == 401 and last.json()["attempts_left"] == 0
    # 6回目＝pre-auth はもう無い
    r = client.post(VERIFY, json={"code": "000000"}, headers=_csrf(client))
    assert r.status_code == 401 and r.json()["code"] == "preauth_expired"


def test_a_tc_063_verify_success_issues_session(client, factory, mail):
    """A-TC-063 正しい OTP→200 authenticated＋iq_session 発行・pre-auth 消費。A.0-③。"""
    account = factory.make_seed_mfa_account()
    _login_mfa(client, mail, account["company_code"], account["login_id"])
    otp = _otp_from_mail(mail)
    r = client.post(VERIFY, json={"code": otp}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "authenticated"
    assert r.cookies.get("iq_session")
    # セッションが有効（GET /session が通る）
    assert client.get(SESSION).status_code == 200


def test_a_tc_064_verify_trust_device_skips_mfa_next_login(client, factory, mail):
    """A-TC-064 trust_device=true→iq_trust 発行＋trusted_devices 登録→次回 login は MFA スキップ。A.0-①。"""
    account = factory.make_seed_mfa_account()
    _login_mfa(client, mail, account["company_code"], account["login_id"])
    otp = _otp_from_mail(mail)
    r = client.post(VERIFY, json={"code": otp, "trust_device": True}, headers=_csrf(client))
    assert r.status_code == 200
    assert r.cookies.get("iq_trust")
    # 同一端末（iq_trust 保持）で再ログイン→MFA を要求されない
    r2 = client.post(LOGIN, json={"company_code": account["company_code"], "login_id": account["login_id"], "password": account["password"]})
    assert r2.status_code == 200
    assert r2.json()["status"] == "authenticated"


def test_a_tc_065_verify_without_preauth_401(client):
    """A-TC-065 pre-auth 無しで verify→401 preauth_expired（CSRF より先に評価）。A.0/A-TC-015 方針。"""
    r = client.post(VERIFY, json={"code": "123456"})
    assert r.status_code == 401
    assert r.json()["code"] == "preauth_expired"


def test_a_tc_066_verify_without_csrf_403(client, factory, mail):
    """A-TC-066 pre-auth 有・CSRF 無→403 csrf_failed（pre-auth 401 の後に CSRF 403）。A.0。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    _login_mfa(client, mail, company["company_code"], account["login_id"])
    r = client.post(VERIFY, json={"code": "123456"})  # X-CSRF-Token 無し
    assert r.status_code == 403
    assert r.json()["code"] == "csrf_failed"


def test_a_tc_067_resend_cooldown_429(client, factory, mail):
    """A-TC-067 クールダウン中の resend→429 rate_limited＋Retry-After。A.1/ADR-0004 §2.4。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    _login_mfa(client, mail, company["company_code"], account["login_id"])
    r = client.post(RESEND, headers=_csrf(client))
    assert r.status_code == 429
    assert r.json()["code"] == "rate_limited"
    assert r.headers.get("Retry-After")


def test_a_tc_068_resend_after_cooldown_new_otp(client, factory, mail):
    """A-TC-068 クールダウン経過後の resend→200・新OTP送信・旧OTPは無効。A.1/ADR-0004 §2.2。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    _login_mfa(client, mail, company["company_code"], account["login_id"])
    old_otp = _otp_from_mail(mail)
    # クールダウンを経過扱いにする（resend_available_at を過去へ）
    r = get_redis()
    tok = client.cookies.get("iq_preauth")
    pa = read_preauth(r, tok)
    pa["resend_available_at"] = 0
    save_preauth(r, tok, pa)
    resp = client.post(RESEND, headers=_csrf(client))
    assert resp.status_code == 200
    assert resp.json()["expires_in"] == 600
    assert len(mail.sent) == 2  # 新OTP を送信
    new_otp = _otp_from_mail(mail)
    # 旧OTP は無効（新OTP に置換済み）。異なる前提で誤り扱い
    if old_otp != new_otp:
        bad = client.post(VERIFY, json={"code": old_otp}, headers=_csrf(client))
        assert bad.status_code == 401 and bad.json()["code"] == "otp_invalid"


def test_a_tc_069_verify_otp_expired_401(client, factory, mail):
    """A-TC-069 OTP 期限切れ→401 otp_expired。A.1。"""
    company = factory.make_company(mfa_required=True)
    account = factory.make_account(company)
    _login_mfa(client, mail, company["company_code"], account["login_id"])
    otp = _otp_from_mail(mail)
    # OTP の有効期限を過去へ（pre-auth 自体は生存）
    r = get_redis()
    tok = client.cookies.get("iq_preauth")
    pa = read_preauth(r, tok)
    pa["otp_expires_at"] = 0
    save_preauth(r, tok, pa)
    resp = client.post(VERIFY, json={"code": otp}, headers=_csrf(client))
    assert resp.status_code == 401
    assert resp.json()["code"] == "otp_expired"


def test_a_tc_070_logout_all_revokes_trust(client, factory, mail):
    """A-TC-070 logout-all→204・全セッション破棄＋信頼端末失効→次回 login は再び MFA 必須。A.0-⑤。"""
    account = factory.make_seed_mfa_account()
    _login_mfa(client, mail, account["company_code"], account["login_id"])
    otp = _otp_from_mail(mail)
    client.post(VERIFY, json={"code": otp, "trust_device": True}, headers=_csrf(client))
    # logout-all（本セッション＋CSRF 必須）
    r = client.post(LOGOUT_ALL, headers=_csrf(client))
    assert r.status_code == 204
    # 信頼端末が失効＝再ログインで再び MFA 必須
    r2 = client.post(LOGIN, json={"company_code": account["company_code"], "login_id": account["login_id"], "password": account["password"]})
    assert r2.status_code == 200
    assert r2.json()["status"] == "mfa_required"


LOGOUT = "/api/v1/auth/logout"


def _trust_and_logout(client, mail, company_code, login_id, password):
    """当該アカウントで MFA→verify(trust_device)→通常 logout（iq_trust は温存）まで進める。"""
    _login_mfa(client, mail, company_code, login_id, password)
    otp = _otp_from_mail(mail)
    r = client.post(VERIFY, json={"code": otp, "trust_device": True}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    client.post(LOGOUT, headers=_csrf(client))


def test_a_tc_071_multiple_users_trust_coexist(client, factory, mail):
    """A-TC-071 同一端末を A/B が各自信頼→iq_trust 複数トークン保持→後の信頼で前が上書きされず両者スキップ。ADR-0004 §2.3.1。"""
    # 認証成功まで進める＝実テナントDBを持つシード MFA 会社の実アカウントを2つ（呼ぶたび別アカウント）。
    a = factory.make_seed_mfa_account()
    b = factory.make_seed_mfa_account()
    _trust_and_logout(client, mail, a["company_code"], a["login_id"], a["password"])
    _trust_and_logout(client, mail, b["company_code"], b["login_id"], b["password"])  # 同じ client=同じ iq_trust に追記
    # A の再 login は B の信頼で上書きされず authenticated（MFA スキップ）
    ra = client.post(LOGIN, json={"company_code": a["company_code"], "login_id": a["login_id"], "password": a["password"]})
    assert ra.status_code == 200 and ra.json()["status"] == "authenticated", ra.text
    client.post(LOGOUT, headers=_csrf(client))
    # B も同様に authenticated
    rb = client.post(LOGIN, json={"company_code": b["company_code"], "login_id": b["login_id"], "password": b["password"]})
    assert rb.status_code == 200 and rb.json()["status"] == "authenticated", rb.text


def test_a_tc_072_logout_all_keeps_other_user_trust(client, factory, mail):
    """A-TC-072 A の logout-all は B の信頼を巻き添えにしない（iq_trust を消さない）。ADR-0004 §2.3.1。"""
    a = factory.make_seed_mfa_account()
    b = factory.make_seed_mfa_account()
    _trust_and_logout(client, mail, a["company_code"], a["login_id"], a["password"])
    _trust_and_logout(client, mail, b["company_code"], b["login_id"], b["password"])
    # A で再 login（trust skip）してから logout-all（A の信頼端末を revoke）
    ra = client.post(LOGIN, json={"company_code": a["company_code"], "login_id": a["login_id"], "password": a["password"]})
    assert ra.json()["status"] == "authenticated", ra.text
    assert client.post(LOGOUT_ALL, headers=_csrf(client)).status_code == 204
    # A は再び MFA 必須（DB 側 revoke）／B は authenticated（B のトークンは温存＝クッキー削除しない）
    ra2 = client.post(LOGIN, json={"company_code": a["company_code"], "login_id": a["login_id"], "password": a["password"]})
    assert ra2.json()["status"] == "mfa_required", ra2.text
    rb = client.post(LOGIN, json={"company_code": b["company_code"], "login_id": b["login_id"], "password": b["password"]})
    assert rb.json()["status"] == "authenticated", rb.text
