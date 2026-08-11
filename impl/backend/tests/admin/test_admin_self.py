"""会社アカウント管理者 API のテスト（doc/テスト/B_会社・アカウント.md §2・API設計 B.2.1）。

`/admin/accounts`（`company_account_admin`・セッション会社固定）。system_admin は上位互換で可。
できる＝自社アカウントの発行/編集/disable/enable/password-reset（`general` のみ・ロール付与不可）。
できない＝`system_role` 付与、system_admin アカウントの disable。
"""
from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.control_plane.auth.orm import Account
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.main import app
from app.tenant.quest_group.orm import QuestGroup
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _company, _csrf, _ident, issued  # noqa: F401 (issued は fixture)
from tests.conftest import SEED_COMPANY_CODE

ACCOUNTS = "/api/v1/admin/accounts"
COMPANY_QG = "/api/v1/admin/company-quest-groups"


def _login_company_admin(client, factory) -> dict:
    admin = factory.make_seed_company_account(system_role="company_account_admin")
    _login(client, admin["company_code"], admin["login_id"], admin["password"])
    return admin


def test_b_tc_044_company_admin_lists_own_quest_groups(client, factory):
    """B-TC-044 会社アカ管理者が自社の全クエストグループ一覧を取得（所属エディタ候補）。general は 403。根拠 B.2.1。"""
    _, db_id = _company(SEED_COMPANY_CODE)
    gid = uuid.uuid4()
    code = f"QGSELF-{uuid.uuid4().hex[:6].upper()}"
    with get_tenant_session(db_id) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=code, name="Self QG"))
        ts.commit()
    try:
        _login_company_admin(client, factory)
        r = client.get(COMPANY_QG)
        assert r.status_code == 200, r.text
        codes = [g["quest_group_code"] for g in r.json()["data"]]
        assert code in codes

        general = factory.make_seed_company_account(system_role="general")
        _login(client, general["company_code"], general["login_id"], general["password"])
        assert client.get(COMPANY_QG).status_code == 403
    finally:
        with get_tenant_session(db_id) as ts:
            ts.query(QuestGroup).filter_by(id=gid).delete()
            ts.commit()


def test_b_tc_040_company_admin_lists_own(client, factory):
    """B-TC-040 会社アカウント管理者が自社アカウント一覧を取得（セッション会社固定）。根拠 B.2.1。"""
    _login_company_admin(client, factory)
    r = client.get(ACCOUNTS)
    assert r.status_code == 200
    logins = [a["login_id"] for a in r.json()["data"]]
    assert "user@acme.example" in logins  # ACME-01 スコープ


def test_b_tc_041_company_admin_issues_general(client, factory, issued):
    """B-TC-041 発行＝201・`system_role=general` 固定・セッション会社（ACME-01）配下に作成。根拠 B.2.1。"""
    _login_company_admin(client, factory)
    r = client.post(ACCOUNTS, json=_ident(), headers=_csrf(client))
    assert r.status_code == 201, r.text
    body = r.json()
    issued.append(uuid.UUID(body["account_id"]))
    assert body["system_role"] == "general"
    cid, _ = _company(SEED_COMPANY_CODE)
    with control_session() as s:
        acc = s.query(Account).filter_by(id=uuid.UUID(body["account_id"])).one()
    assert acc.company_id == cid


def test_b_tc_042_company_admin_restrictions(client, factory):
    """B-TC-042 会社アカ管理者は `system_role` 付与不可（422）／system_admin の disable 不可（403）。根拠 B.2.1。"""
    _login_company_admin(client, factory)
    # (a) system_role をボディに入れると 422（extra=forbid＝受け取らない）
    r1 = client.post(ACCOUNTS, json={**_ident(), "system_role": "system_admin"}, headers=_csrf(client))
    assert r1.status_code == 422
    # (b) system_admin アカウント（同社に作成）を disable → 403
    sysadmin = factory.make_seed_company_account(system_role="system_admin")
    r2 = client.post(f"{ACCOUNTS}/{sysadmin['id']}/disable", headers=_csrf(client))
    assert r2.status_code == 403 and r2.json()["code"] == "forbidden"


def test_b_tc_043_authz_general_forbidden_sysadmin_ok(client, factory):
    """B-TC-043 general は 403／system_admin は上位互換で 200（B.2.1）。"""
    general = factory.make_seed_company_account()
    _login(client, general["company_code"], general["login_id"], general["password"])
    assert client.get(ACCOUNTS).status_code == 403

    tclient = TestClient(app)
    _login_system_admin(tclient)
    assert tclient.get(ACCOUNTS).status_code == 200  # 上位互換（session 会社=OPS）
