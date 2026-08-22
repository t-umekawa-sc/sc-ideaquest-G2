"""B-TC-162〜164: 会社DB プロビジョニング（SC-92「会社DB」・B.1・POST /admin/companies/{id}/provision）。

system_admin（OPS）専用。seed 会社 ACME-01 は整備済み＝再実行が冪等に 200・active になることを確認
（新規DB作成/DROP は伴わない）。認可（一般＝403）・存在秘匿（不明会社＝404）も検証。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _company_id(code: str) -> uuid.UUID:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=code).one().id


def _url(cid) -> str:
    return f"/api/v1/admin/companies/{cid}/provision"


def test_b_tc_162_provision_is_idempotent_and_activates(client):
    """B-TC-162: 整備済み会社への provision は冪等＝200・status=active。"""
    _login_system_admin(client)
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.post(_url(cid), headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"


def test_b_tc_163_provision_forbidden_for_general(client):
    """B-TC-163: 非 system_admin は 403（B.0.1 P6）。"""
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.post(_url(cid), headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_b_tc_164_provision_unknown_company_404(client):
    """B-TC-164: 存在しない会社は 404（存在秘匿・§1.6）。"""
    _login_system_admin(client)
    r = client.post(_url(uuid.uuid4()), headers=_csrf(client))
    assert r.status_code == 404, r.text
