"""認可の SoD 境界（doc/テスト/B §5・API設計 B.0.1 P6・§8-⑯）。

`require_system_admin` を課す全 EP（B.1 会社 CRUD／B.2 クロステナント `/admin/companies/{id}/accounts` 系／
B.3 `/admin/companies/{id}/quest-groups` CRUD）が、**`general` と `company_account_admin` の双方で 403**
になることを一括確認する＝会社アカウント管理者でも会社/グループ構造・クロステナントには越権できない（SoD）。
認可 dep は CSRF/Origin より先に評価されるため、正当な CSRF を付けても 403 `forbidden`。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _company_id() -> uuid.UUID:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id


def _system_admin_only_endpoints(cid: uuid.UUID):
    """(method, path, json) の list。認可 dep が先に効くので body/対象の実在は問わない（valid body を渡す）。"""
    aid, gid = uuid.uuid4(), uuid.uuid4()
    base = "/api/v1/admin/companies"
    ident = {"display_name": "X", "login_id": "sod@x.example", "email": "sod@x.example"}
    return [
        ("get", base, None),
        ("post", base, {"name": "SoD", "company_code": "SODTEST", "db_identifier": "ideaquest_sod"}),
        ("get", f"{base}/{cid}", None),
        ("patch", f"{base}/{cid}", {"name": "X"}),
        ("patch", f"{base}/{cid}/settings", {"mfa_required": True}),
        ("get", f"{base}/{cid}/accounts", None),
        ("post", f"{base}/{cid}/accounts", ident),
        ("patch", f"{base}/{cid}/accounts/{aid}", {"display_name": "X"}),
        ("post", f"{base}/{cid}/accounts/{aid}/disable", None),
        ("post", f"{base}/{cid}/accounts/{aid}/enable", None),
        ("post", f"{base}/{cid}/accounts/{aid}/password-reset", None),
        ("get", f"{base}/{cid}/quest-groups", None),
        ("post", f"{base}/{cid}/quest-groups", {"quest_group_code": "SODT", "name": "X"}),
        ("patch", f"{base}/{cid}/quest-groups/{gid}", {"name": "X"}),
        ("delete", f"{base}/{cid}/quest-groups/{gid}", None),
    ]


def _assert_all_forbidden(client, role: str | None):
    cid = _company_id()
    for method, path, body in _system_admin_only_endpoints(cid):
        kwargs = {"headers": _csrf(client)}
        if body is not None:
            kwargs["json"] = body
        r = getattr(client, method)(path, **kwargs)
        assert r.status_code == 403, f"{role} {method.upper()} {path} → {r.status_code} (expect 403)\n{r.text}"
        assert r.json()["code"] == "forbidden", f"{role} {method.upper()} {path}: {r.text}"


def test_b_tc_094_general_forbidden_on_system_admin_endpoints(client, factory):
    """B-TC-094 general は system_admin 専用 EP 群すべてで 403 forbidden（B.0.1 P6）。"""
    acc = factory.make_seed_company_account(system_role="general")
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    _assert_all_forbidden(client, "general")


def test_b_tc_095_company_admin_forbidden_on_system_admin_endpoints(client, factory):
    """B-TC-095 company_account_admin も system_admin 専用 EP 群すべてで 403＝越権不可（SoD・§8-⑯）。"""
    acc = factory.make_seed_company_account(system_role="company_account_admin")
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    _assert_all_forbidden(client, "company_account_admin")
