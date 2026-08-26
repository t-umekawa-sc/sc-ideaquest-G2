"""システム監査ログ（doc/テスト/B §6・API設計 B.6・データモデル §4.5）。

特権操作が管理DB system_audit_logs に監査行を残す／読み取り・認可失敗は残さない、を確認。
実行者/IP/UA は AuditContextMiddleware（contextvar）が供給。監査行は conftest の autouse で各テスト前後に truncate。
"""
from __future__ import annotations

import uuid

from app.control_plane.audit.orm import SystemAuditLog
from app.control_plane.auth.orm import Account, Company
from app.core.config import get_settings
from app.db.control import control_session
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.conftest import SEED_COMPANY_CODE


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _company_id() -> uuid.UUID:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id


def _ops_admin_id() -> uuid.UUID:
    s = get_settings()
    with control_session() as sess:
        return sess.query(Account).filter_by(login_id=s.bootstrap_admin_login).one().id


def _audit(action: str | None = None) -> list[SystemAuditLog]:
    with control_session() as s:
        q = s.query(SystemAuditLog)
        if action is not None:
            q = q.filter_by(action=action)
        return list(q.all())


def _clear_audit() -> None:
    """login 由来の監査（auth.login.new_device・A.9-⑧(a)）を掃除＝以降の read/authz 検証を切り分ける。"""
    with control_session() as s:
        s.query(SystemAuditLog).delete()
        s.commit()


def test_b_tc_100_mutation_writes_audit(client, factory):
    """B-TC-100 disable／会社設定更新が監査行を1件残す（actor=実行者・detail=対象・ip 記録）。"""
    _login_system_admin(client)
    ops_id = _ops_admin_id()
    cid = _company_id()

    # account.disable（control-Tx 相乗）
    target = factory.make_seed_company_account()
    r = client.post(f"/api/v1/admin/companies/{cid}/accounts/{target['id']}/disable", headers=_csrf(client))
    assert r.status_code == 200, r.text
    rows = _audit("account.disable")
    assert len(rows) == 1
    assert str(rows[0].actor_account_id) == str(ops_id)          # 実行者＝OPS 管理者
    assert rows[0].detail["account_id"] == str(target["id"])     # 対象を記録
    assert rows[0].ip is not None                                 # middleware が確定 IP を記録

    # company.settings_update（control-only の会社で・共有 seed を汚さない）
    comp = factory.make_company()
    r2 = client.patch(f"/api/v1/admin/companies/{comp['id']}/settings",
                      json={"mfa_required": False}, headers=_csrf(client))
    assert r2.status_code == 200, r2.text
    srows = _audit("company.settings_update")
    assert len(srows) == 1 and srows[0].detail["company_id"] == str(comp["id"])


def test_b_tc_101_reads_not_audited(client):
    """B-TC-101 一覧 GET など読み取りは監査行を作らない（変更系のみ）。"""
    _login_system_admin(client)
    _clear_audit()  # login 由来の監査を除去（read が監査しないことの検証に集中）
    cid = _company_id()
    client.get("/api/v1/admin/companies")
    client.get(f"/api/v1/admin/companies/{cid}/accounts")
    client.get(f"/api/v1/admin/companies/{cid}/quest-groups")
    assert _audit() == []


def test_b_tc_102_failed_authz_not_audited(client, factory):
    """B-TC-102 認可失敗（general→403）は監査行を作らない（操作が起きていない）。"""
    acc = factory.make_seed_company_account(system_role="general")
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    _clear_audit()  # login 由来の監査を除去（認可失敗が監査しないことの検証に集中）
    cid = _company_id()
    r = client.post(f"/api/v1/admin/companies/{cid}/accounts/{uuid.uuid4()}/disable", headers=_csrf(client))
    assert r.status_code == 403
    assert _audit() == []
