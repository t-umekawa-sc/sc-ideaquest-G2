"""管理者によるメールアドレス確認 送信 API（doc/テスト/B_会社・アカウント.md §19・ADR-0009）。

送信 EP（B.2 system_admin／B.2.1 company_account_admin）＝現メール宛に確認リンク（email_verify・72h・現メール宛）。
一覧行の email_verified・email 変更での NULL リセットを検証する。確定 EP（公開）は tests/auth 側。
"""
from __future__ import annotations

from app.control_plane.auth.orm import Account, OtpChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.db.control import control_session
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _company, _csrf
from tests.admin.test_admin_self import _login_company_admin
from tests.conftest import SEED_COMPANY_CODE

ACCOUNTS = "/api/v1/admin/accounts"


def _verify_url(company_id, account_id) -> str:
    return f"/api/v1/admin/companies/{company_id}/accounts/{account_id}/email-verification"


def test_b_tc_165_send_email_verification_system_admin(client, factory):
    """B-TC-165 確認メール送信（system_admin・B.2）＝202＋email_verify チャレンジ＋現メール宛 outbox。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)

    r = client.post(_verify_url(cid, target["id"]), headers=_csrf(client))

    assert r.status_code == 202, r.text
    assert r.json()["status"] == "sent"
    with control_session() as s:
        challenges = s.query(OtpChallenge).filter_by(account_id=target["id"], purpose="email_verify").all()
        mail = s.query(MailOutboxEntry).filter_by(account_id=target["id"], category="email_verify_link").all()
    assert len(challenges) == 1 and challenges[0].used_at is None
    assert challenges[0].target_email == target["email"]
    assert len(mail) == 1 and mail[0].secret and mail[0].to_email == target["email"]


def test_b_tc_166_send_email_verification_company_admin(client, factory):
    """B-TC-166 自社アカウントへ確認メール送信（company_account_admin・B.2.1）＝202。"""
    target = factory.make_seed_company_account()
    _login_company_admin(client, factory)

    r = client.post(f"{ACCOUNTS}/{target['id']}/email-verification", headers=_csrf(client))

    assert r.status_code == 202, r.text
    with control_session() as s:
        challenges = s.query(OtpChallenge).filter_by(account_id=target["id"], purpose="email_verify").all()
    assert len(challenges) == 1


def test_b_tc_167_patch_email_resets_verified(client, factory):
    """B-TC-167 email 変更で email_verified が false に戻る（ADR-0009 §2.3）。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    # 事前に確認済みへ（DB 直更新でフラグを立てる）
    from datetime import datetime, timezone
    with control_session() as s:
        acc = s.query(Account).filter_by(id=target["id"]).one()
        acc.email_verified_at = datetime.now(timezone.utc)
        s.commit()
    _login_system_admin(client)
    new_email = f"changed-{target['login_id']}@example.com"
    r = client.patch(f"/api/v1/admin/companies/{cid}/accounts/{target['id']}",
                     json={"email": new_email}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["email_verified"] is False
    # 一覧行でも false
    lst = client.get(f"/api/v1/admin/companies/{cid}/accounts", params={"q": new_email}).json()
    row = next((a for a in lst["data"] if a["account_id"] == str(target["id"])), None)
    assert row is not None and row["email_verified"] is False


def test_b_tc_168_list_has_email_verified_false_on_issue(client, factory):
    """B-TC-168 一覧行に email_verified（発行直後は false）。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)
    lst = client.get(f"/api/v1/admin/companies/{cid}/accounts", params={"q": target["email"]}).json()
    row = next((a for a in lst["data"] if a["account_id"] == str(target["id"])), None)
    assert row is not None and row["email_verified"] is False
