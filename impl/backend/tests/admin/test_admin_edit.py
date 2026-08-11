"""アカウント編集 API のテスト（doc/テスト/B_会社・アカウント.md §2・API設計 B.2）。

`PATCH /admin/companies/{company_id}/accounts/{account_id}`（system_admin・差分）。
identity 一意再検証（409）・system_role 変更で対象の全セッション破棄（A.9-③）・
自己降格/0名化の拒否（`last_system_admin`）を検証する。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account
from app.core.config import get_settings
from app.db.control import control_session
from app.main import app
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _company, _csrf
from tests.conftest import SEED_COMPANY_CODE

SESSION = "/api/v1/auth/session"


def _url(company_id, account_id) -> str:
    return f"/api/v1/admin/companies/{company_id}/accounts/{account_id}"


def test_b_tc_030_edit_identity(client, factory):
    """B-TC-030 identity/表示名の差分編集＝200＋accounts 更新＋outbox（users ミラー）。根拠 B.2。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)
    new_login = f"renamed-{uuid.uuid4().hex[:8]}@acme.example"

    r = client.patch(_url(cid, target["id"]), json={"display_name": "Renamed", "login_id": new_login},
                      headers=_csrf(client))

    assert r.status_code == 200, r.text
    assert r.json()["login_id"] == new_login and r.json()["display_name"] == "Renamed"
    with control_session() as s:
        acc = s.query(Account).filter_by(id=target["id"]).one()
        outbox = s.query(OutboxEntry).filter_by(account_id=target["id"]).all()
    assert acc.login_id == new_login
    assert any(o.op == "upsert" and "login_id" in o.payload for o in outbox)


def test_b_tc_031_duplicate_identity_conflict(client, factory):
    """B-TC-031 既存の別アカウントと login_id/email が重複する編集は 409（自分は除外）。根拠 B.2。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)

    # seed の user@acme.example と衝突させる
    r = client.patch(_url(cid, target["id"]), json={"login_id": "user@acme.example"}, headers=_csrf(client))
    assert r.status_code == 409 and r.json()["errors"][0]["field"] == "login_id"


def test_b_tc_032_role_change_destroys_sessions(client, factory):
    """B-TC-032 system_role 変更で対象の全セッション破棄（新権限適用・A.9-③）。根拠 B.2。"""
    target = factory.make_seed_company_account()          # general
    cid, _ = _company(SEED_COMPANY_CODE)

    tclient = TestClient(app)
    _login(tclient, target["company_code"], target["login_id"], target["password"])
    assert tclient.get(SESSION).status_code == 200

    _login_system_admin(client)
    r = client.patch(_url(cid, target["id"]), json={"system_role": "company_account_admin"},
                     headers=_csrf(client))

    assert r.status_code == 200 and r.json()["system_role"] == "company_account_admin"
    assert tclient.get(SESSION).status_code == 401       # 対象の全セッション破棄


def test_b_tc_033_self_demotion_forbidden(client):
    """B-TC-033 自分自身の system_admin→降格は不可（自己ロックアウト防止・422）。根拠 B.2。"""
    _login_system_admin(client)
    s = get_settings()
    with control_session() as sess:
        admin = sess.query(Account).filter_by(login_id=s.bootstrap_admin_login).one()
        ops_id, admin_id = admin.company_id, admin.id

    r = client.patch(_url(ops_id, admin_id), json={"system_role": "general"}, headers=_csrf(client))

    assert r.status_code == 422 and r.json()["code"] == "last_system_admin"


def test_b_tc_034_validation_and_404(client, factory):
    """B-TC-034 不正 system_role/想定外プロパティは 422・不明会社/アカウントは 404。根拠 B.2/§B.6。"""
    target = factory.make_seed_company_account()
    cid, _ = _company(SEED_COMPANY_CODE)
    _login_system_admin(client)

    r1 = client.patch(_url(cid, target["id"]), json={"system_role": "quest_group_admin"}, headers=_csrf(client))
    assert r1.status_code == 422
    r2 = client.patch(_url(cid, target["id"]), json={"is_admin": True}, headers=_csrf(client))
    assert r2.status_code == 422
    r3 = client.patch(_url(cid, uuid.uuid4()), json={"display_name": "X"}, headers=_csrf(client))
    assert r3.status_code == 404 and r3.json()["code"] == "not_found"
