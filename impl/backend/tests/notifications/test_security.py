"""H-TC-151〜162: セキュリティ通知の cross-plane 発火（A.9-⑧・H.0・§4）。

認証フロー（login/mfa verify/password-setup complete）とプロフィール（自己PW変更）が、確定した
company_id でテナントDB `notifications` へ post-commit 発火する。in-app（notifications）＋メール
（mail_outbox）を実データで検証。new_device の端末認識＝有効 iq_trust（MFA-ON=毎回 OTP／MFA-OFF=
iq_trust を認識に流用）。すべて本人宛（列挙耐性の問題なし）。
"""
from __future__ import annotations

import re
import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.notifications.orm import Notification
from app.tenant.profile.repository import get_user_by_account
from tests.conftest import SEED_COMPANY_CODE, SEED_MFA_COMPANY_CODE

LOGIN = "/api/v1/auth/login"
VERIFY = "/api/v1/auth/mfa/verify"
COMPLETE = "/api/v1/auth/password-setup/complete"
ME_PASSWORD = "/api/v1/me/password"
GOOD_PW = "Passw0rd!"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _otp_from_mail(mail) -> str:
    m = re.search(r"認証コード:\s*(\d{6})", mail.sent[-1].body)
    assert m, f"OTP not found: {mail.sent[-1].body!r}"
    return m.group(1)


def _security_notifs(company_code: str, account_id: uuid.UUID, type: str) -> list[dict]:
    """当該アカウントの受信通知（指定種別）をテナントDBから素の値で返す（session close 後も安全）。"""
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=company_code).one().db_identifier
    with get_tenant_session(db_identifier) as ts:
        user = get_user_by_account(ts, account_id)
        rows = ts.query(Notification).filter_by(recipient_id=user.id, type=type).all()
        return [{"type": r.type, "params": r.params, "is_read": r.is_read} for r in rows]


def _login(client, acc) -> None:
    r = client.post(LOGIN, json={"company_code": acc["company_code"],
                                 "login_id": acc["login_id"], "password": GOOD_PW})
    assert r.status_code == 200, r.text


def _mail_subjects(mail) -> list[str]:
    return [m.subject for m in mail.sent]


# --- new_device（A.9-⑧(a)） --------------------------------------------------------------

def test_h_tc_151_mfa_off_new_device_notifies_and_mails(client, factory, mail):
    """H-TC-151 MFA-OFF 未登録端末ログイン→新端末通知＋メール＋iq_trust 発行。"""
    acc = factory.make_seed_company_account()
    r = client.post(LOGIN, json={"company_code": acc["company_code"],
                                 "login_id": acc["login_id"], "password": GOOD_PW})
    assert r.status_code == 200 and r.json()["status"] == "authenticated", r.text
    ns = _security_notifs(SEED_COMPANY_CODE, acc["id"], "security_new_device")
    assert len(ns) == 1
    assert ns[0]["params"] and ns[0]["params"].get("device") and ns[0]["params"].get("at")
    assert any("新しい端末" in s for s in _mail_subjects(mail))   # MFA-OFF 前倒しメール
    assert client.cookies.get("iq_trust")                          # 端末認識トークン発行


def test_h_tc_152_mfa_off_known_device_silent(client, factory, mail):
    """H-TC-152 同端末（有効 iq_trust）の再ログインは新端末通知しない（ノイズ回避）。"""
    acc = factory.make_seed_company_account()
    _login(client, acc)
    assert len(_security_notifs(SEED_COMPANY_CODE, acc["id"], "security_new_device")) == 1
    mails_first = sum("新しい端末" in s for s in _mail_subjects(mail))
    _login(client, acc)  # iq_trust 保持で再ログイン＝既知端末
    assert len(_security_notifs(SEED_COMPANY_CODE, acc["id"], "security_new_device")) == 1
    assert sum("新しい端末" in s for s in _mail_subjects(mail)) == mails_first


def test_h_tc_153_mfa_on_verify_new_device_no_mail(client, factory, mail):
    """H-TC-153 MFA-ON verify 成功（未登録端末）→新端末通知・メールは送らない（OTP と経路重複）。"""
    acc = factory.make_seed_mfa_account()
    r = client.post(LOGIN, json={"company_code": acc["company_code"],
                                 "login_id": acc["login_id"], "password": GOOD_PW})
    assert r.json()["status"] == "mfa_required"
    otp = _otp_from_mail(mail)
    r2 = client.post(VERIFY, json={"code": otp}, headers=_csrf(client))
    assert r2.status_code == 200 and r2.json()["status"] == "authenticated", r2.text
    assert len(_security_notifs(SEED_MFA_COMPANY_CODE, acc["id"], "security_new_device")) == 1
    subjects = _mail_subjects(mail)
    assert not any("新しい端末" in s for s in subjects)   # MFA-ON はメール無し
    assert any("認証コード" in s for s in subjects)         # OTP は送っている


def test_h_tc_154_mfa_on_trusted_device_silent(client, factory, mail):
    """H-TC-154 信頼端末で MFA スキップの再ログインは新端末通知しない（既知端末）。"""
    acc = factory.make_seed_mfa_account()
    client.post(LOGIN, json={"company_code": acc["company_code"],
                             "login_id": acc["login_id"], "password": GOOD_PW})
    otp = _otp_from_mail(mail)
    r = client.post(VERIFY, json={"code": otp, "trust_device": True}, headers=_csrf(client))
    assert r.status_code == 200
    assert len(_security_notifs(SEED_MFA_COMPANY_CODE, acc["id"], "security_new_device")) == 1
    r2 = client.post(LOGIN, json={"company_code": acc["company_code"],
                                  "login_id": acc["login_id"], "password": GOOD_PW})
    assert r2.json()["status"] == "authenticated"  # 信頼端末で MFA スキップ
    assert len(_security_notifs(SEED_MFA_COMPANY_CODE, acc["id"], "security_new_device")) == 1


# --- password_changed（A.9-⑧(b)） -------------------------------------------------------

def test_h_tc_161_password_setup_complete_notifies_and_mails(client, factory, mail):
    """H-TC-161 PW 設定完了（A 経路）→変更完了通知＋メール。"""
    acc = factory.make_seed_company_account(password_set=False)
    token = factory.make_password_setup_challenge(acc["id"])
    r = client.post(COMPLETE, json={"token": token, "new_password": GOOD_PW})
    assert r.status_code == 200, r.text
    assert len(_security_notifs(SEED_COMPANY_CODE, acc["id"], "security_password_changed")) == 1
    assert any("パスワードが変更されました" in s for s in _mail_subjects(mail))


def test_h_tc_162_self_password_change_notifies_and_mails(client, factory, mail):
    """H-TC-162 自己 PW 変更（K 経路）→変更完了通知＋メール＋全セッション破棄。"""
    acc = factory.make_seed_company_account()
    _login(client, acc)
    r = client.post(ME_PASSWORD, json={"current_password": GOOD_PW, "new_password": "Passw0rd!2"},
                    headers=_csrf(client))
    assert r.status_code == 204, r.text
    assert len(_security_notifs(SEED_COMPANY_CODE, acc["id"], "security_password_changed")) == 1
    assert any("パスワードが変更されました" in s for s in _mail_subjects(mail))
