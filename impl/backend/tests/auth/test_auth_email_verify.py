"""メールアドレス確認の確定 EP（doc/テスト/A_認証.md §8・ADR-0009）。

公開 confirm＝POST /api/v1/auth/email-verify/confirm（未認証＝トークンが認可）。送信は管理者 EP（B.2）で行い、
mail_outbox のリンクから token を取り出して確定する。無効/期限/使用済は 410、送信後 email 変更は 409 stale。
"""
from __future__ import annotations

import re

from app.control_plane.auth.orm import Account
from app.db.control import control_session
from fastapi.testclient import TestClient
from app.main import app
from tests.admin.test_admin_accounts import _login_system_admin
from tests.admin.test_admin_issue import _company, _csrf
from tests.conftest import SEED_COMPANY_CODE

CONFIRM = "/api/v1/auth/email-verify/confirm"


def _verify_url(cid, aid) -> str:
    return f"/api/v1/admin/companies/{cid}/accounts/{aid}/email-verification"


def _token_from_mail(sent_mail) -> str:
    m = re.search(r"token=(\S+)", sent_mail.body)
    assert m, "確認リンクに token が含まれること"
    return m.group(1)


def _send_and_get_token(client, mail, factory) -> dict:
    """対象アカウントを作り、確認メールを送信して token を取り出す（管理者経路）。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)
    r = client.post(_verify_url(cid, target["id"]), headers=_csrf(client))
    assert r.status_code == 202, r.text
    token = _token_from_mail(mail.sent[-1])
    return {"target": target, "cid": cid, "token": token}


def test_a_tc_103_confirm_sets_verified(client, factory, mail):
    """A-TC-103 確認リンクで email_verified_at が刻まれる・単回消費。"""
    ctx = _send_and_get_token(client, mail, factory)
    r = TestClient(app).post(CONFIRM, json={"token": ctx["token"]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "verified"
    with control_session() as s:
        acc = s.query(Account).filter_by(id=ctx["target"]["id"]).one()
    assert acc.email_verified_at is not None


def test_a_tc_104_used_token_is_410(client, factory, mail):
    """A-TC-104 使用済み/無効トークンは一律 410。"""
    ctx = _send_and_get_token(client, mail, factory)
    pub = TestClient(app)
    assert pub.post(CONFIRM, json={"token": ctx["token"]}).status_code == 200
    # 2回目＝使用済み→410
    assert pub.post(CONFIRM, json={"token": ctx["token"]}).status_code == 410
    # でたらめトークン→410
    assert pub.post(CONFIRM, json={"token": "bogus-token"}).status_code == 410


def test_a_tc_105_stale_after_email_change_is_409(client, factory, mail):
    """A-TC-105 送信後に email を別アドレスへ変更→旧トークンで confirm は 409 stale。"""
    ctx = _send_and_get_token(client, mail, factory)
    new_email = f"moved-{ctx['target']['login_id']}@example.com"
    r = client.patch(f"/api/v1/admin/companies/{ctx['cid']}/accounts/{ctx['target']['id']}",
                     json={"email": new_email}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    conf = TestClient(app).post(CONFIRM, json={"token": ctx["token"]})
    assert conf.status_code == 409, conf.text
    with control_session() as s:
        acc = s.query(Account).filter_by(id=ctx["target"]["id"]).one()
    assert acc.email_verified_at is None  # 変えずやり直しを促す


def test_a_tc_106_confirm_is_public(client, factory, mail):
    """A-TC-106 未認証＝トークンが認可（セッション無しの新規クライアントで 200）。"""
    ctx = _send_and_get_token(client, mail, factory)
    pub = TestClient(app)  # セッション Cookie 無し
    assert pub.get("/api/v1/auth/session").status_code == 401
    assert pub.post(CONFIRM, json={"token": ctx["token"]}).status_code == 200
