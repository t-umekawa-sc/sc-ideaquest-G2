"""アカウント管理 API のテスト（doc/テスト/B_会社・アカウント.md §2・API設計 B.2/B.0.1）。

`GET /admin/companies/{company_id}/accounts`（system_admin 専用）＝認可基盤（B0）の実証 EP。
system_admin は bootstrap（B.5.1）が seed する OPS 運営テナントの管理者でログインして得る。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.config import get_settings
from app.db.control import control_session
from tests.conftest import SEED_COMPANY_CODE

LOGIN = "/api/v1/auth/login"


def _login(client, company_code: str, login_id: str, password: str) -> None:
    r = client.post(LOGIN, json={"company_code": company_code, "login_id": login_id, "password": password})
    assert r.status_code == 200, r.text


def _login_system_admin(client) -> None:
    s = get_settings()
    _login(client, s.ops_company_code, s.bootstrap_admin_login, s.bootstrap_admin_password)


def _company_id(code: str):
    with control_session() as s:
        return s.query(Company).filter_by(company_code=code).one().id


def _url(company_id, query: str = "") -> str:
    return f"/api/v1/admin/companies/{company_id}/accounts{query}"


def test_b_tc_010_system_admin_lists_company_accounts(client):
    """B-TC-010 system_admin が会社のアカウント一覧を取得＝200＋data＋page_info.total。根拠 B.2。"""
    _login_system_admin(client)
    cid = _company_id(SEED_COMPANY_CODE)

    r = client.get(_url(cid))

    assert r.status_code == 200, r.text
    body = r.json()
    assert "data" in body and "page_info" in body
    assert body["page_info"]["total"] >= 1
    logins = [a["login_id"] for a in body["data"]]
    assert "user@acme.example" in logins                 # ACME-01 seed アカウント
    assert all("password_hash" not in a for a in body["data"])  # 機密は返さない（§B.6）


def test_b_tc_011_requires_session(client):
    """B-TC-011 セッション無しは 401 unauthenticated（B.0.1 P1）。"""
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 401 and r.json()["code"] == "unauthenticated"


def test_b_tc_012_non_admin_forbidden(client, factory):
    """B-TC-012 非 system_admin（general）は 403 forbidden（B.0.1 P6）。"""
    acc = factory.make_seed_company_account()            # ACME-01 配下の general
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    cid = _company_id(SEED_COMPANY_CODE)
    r = client.get(_url(cid))
    assert r.status_code == 403 and r.json()["code"] == "forbidden"


def test_b_tc_013_unknown_company_404(client):
    """B-TC-013 存在しない company_id は 404 not_found（存在秘匿・B.2/§1.6）。"""
    _login_system_admin(client)
    r = client.get(_url(uuid.uuid4()))
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_b_tc_014_filter_and_pagination(client):
    """B-TC-014 status/q フィルタ＋オフセットページング（§1.8）。根拠 B.2。"""
    _login_system_admin(client)
    cid = _company_id(SEED_COMPANY_CODE)

    r = client.get(_url(cid, "?status=active&per_page=1&page=1"))
    assert r.status_code == 200
    body = r.json()
    assert len(body["data"]) <= 1
    assert body["page_info"]["per_page"] == 1 and body["page_info"]["page"] == 1
    assert body["page_info"]["total"] >= 1

    r2 = client.get(_url(cid, "?q=user@acme"))
    assert r2.status_code == 200
    assert any("user@acme" in a["login_id"] for a in r2.json()["data"])
