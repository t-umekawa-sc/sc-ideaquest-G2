"""アカウント状態管理 API のテスト（doc/テスト/B_会社・アカウント.md §2・API設計 B.2）。

disable/enable/password-reset（system_admin）。disable は全セッション破棄＋信頼端末失効（A.9-③）、
`last_system_admin` 不変条件（有効な system_admin が 0 名になる無効化は拒否）を検証する。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.control_plane.auth.orm import Account, OtpChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.core.config import get_settings
from app.db.control import control_session
from app.main import app
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _company, _csrf
from tests.conftest import SEED_COMPANY_CODE

SESSION = "/api/v1/auth/session"


def _op_url(company_id, account_id, op: str) -> str:
    return f"/api/v1/admin/companies/{company_id}/accounts/{account_id}/{op}"


def test_b_tc_025_disable_destroys_sessions(client, factory):
    """B-TC-025 無効化＝status=disabled＋outbox(disable)＋対象の全セッション破棄（A.9-③）。根拠 B.2。"""
    target = factory.make_seed_company_account()          # ACME-01 general
    cid, _ = _company(SEED_COMPANY_CODE)

    # 対象が別クライアントでログイン＝有効セッションを持つ
    tclient = TestClient(app)
    _login(tclient, target["company_code"], target["login_id"], target["password"])
    assert tclient.get(SESSION).status_code == 200

    _login_system_admin(client)
    r = client.post(_op_url(cid, target["id"], "disable"), headers=_csrf(client))

    assert r.status_code == 200 and r.json()["status"] == "disabled"
    assert tclient.get(SESSION).status_code == 401       # 対象の全セッション破棄
    with control_session() as s:
        acc = s.query(Account).filter_by(id=target["id"]).one()
    assert acc.status == "disabled"


def test_b_tc_026_enable(client, factory):
    """B-TC-026 再有効化＝status=active（B.2）。"""
    target = factory.make_seed_company_account(status="disabled")
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)

    r = client.post(_op_url(cid, target["id"], "enable"), headers=_csrf(client))

    assert r.status_code == 200 and r.json()["status"] == "active"


def test_b_tc_027_password_reset(client, factory):
    """B-TC-027 PWリンク再送＝200 sent＋新 password_setup チャレンジ＋mail_outbox 1行（A.7）。根拠 B.2。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)

    r = client.post(_op_url(cid, target["id"], "password-reset"), headers=_csrf(client))

    assert r.status_code == 200 and r.json()["status"] == "sent"
    with control_session() as s:
        challenges = s.query(OtpChallenge).filter_by(account_id=target["id"], purpose="password_setup").all()
        mail = s.query(MailOutboxEntry).filter_by(account_id=target["id"]).all()
    assert len(challenges) >= 1
    assert len(mail) == 1 and mail[0].category == "password_setup" and mail[0].secret


def test_b_tc_028_last_system_admin_guard(client):
    """B-TC-028 有効な system_admin が 0 名になる無効化は 422 last_system_admin（B.2/B.5.1）。"""
    _login_system_admin(client)
    s = get_settings()
    with control_session() as sess:
        admin = sess.query(Account).filter_by(login_id=s.bootstrap_admin_login).one()  # 唯一の system_admin
        ops_id, admin_id = admin.company_id, admin.id

    r = client.post(_op_url(ops_id, admin_id, "disable"), headers=_csrf(client))

    assert r.status_code == 422 and r.json()["code"] == "last_system_admin"


def test_b_tc_029_unknown_account_404(client):
    """B-TC-029 不明/他会社アカウントの状態変更は 404（存在秘匿・B.2）。"""
    _login_system_admin(client)
    cid, _ = _company(SEED_COMPANY_CODE)
    r = client.post(_op_url(cid, uuid.uuid4(), "disable"), headers=_csrf(client))
    assert r.status_code == 404 and r.json()["code"] == "not_found"
