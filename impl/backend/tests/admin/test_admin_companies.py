"""会社 CRUD API のテスト（doc/テスト/B_会社・アカウント.md §3・API設計 B.1）。

`/admin/companies`（system_admin・SC-91/92）。作成は status=suspended、code は大文字正規化＋一意、
設定 PATCH は記名時に投票者非開示を無効化して整合。作成会社は `companies` フィクスチャで掃除。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_issue import _csrf
from tests.conftest import SEED_COMPANY_CODE

COMPANIES = "/api/v1/admin/companies"


@pytest.fixture
def companies():
    ids: list = []
    yield ids
    with control_session() as s:
        for cid in ids:
            s.query(Company).filter_by(id=cid).delete()
        s.commit()


def _new_company_body() -> dict:
    u = uuid.uuid4().hex[:6].upper()
    return {"name": f"Test {u}", "company_code": f"TST{u}", "db_identifier": f"ideaquest_test_{u.lower()}"}


def test_b_tc_050_list_companies(client):
    """B-TC-050 会社一覧＝200＋data＋page_info、各行に account_count。根拠 B.1。"""
    _login_system_admin(client)
    r = client.get(COMPANIES)
    assert r.status_code == 200
    body = r.json()
    codes = [c["company_code"] for c in body["data"]]
    assert SEED_COMPANY_CODE in codes
    assert all("account_count" in c for c in body["data"])


def test_b_tc_051_create_company(client, companies):
    """B-TC-051 会社作成＝201・status=suspended・company_code は大文字正規化。根拠 B.1。"""
    _login_system_admin(client)
    body = _new_company_body()
    body["company_code"] = body["company_code"].lower()  # 小文字入力 → 大文字正規化される

    r = client.post(COMPANIES, json=body, headers=_csrf(client))

    assert r.status_code == 201, r.text
    data = r.json()
    companies.append(uuid.UUID(data["company_id"]))
    assert data["status"] == "suspended"
    assert data["company_code"] == body["company_code"].upper()


def test_b_tc_052_create_conflict_and_validation(client):
    """B-TC-052 既存 code は 409／不正な code 形式は 422。根拠 B.1（§4.1）。"""
    _login_system_admin(client)
    dup = {**_new_company_body(), "company_code": SEED_COMPANY_CODE}
    r1 = client.post(COMPANIES, json=dup, headers=_csrf(client))
    assert r1.status_code == 409 and r1.json()["errors"][0]["field"] == "company_code"

    bad = {**_new_company_body(), "company_code": "1X"}  # 先頭数字・短すぎ
    r2 = client.post(COMPANIES, json=bad, headers=_csrf(client))
    assert r2.status_code == 422


def test_b_tc_053_detail_and_404(client, companies):
    """B-TC-053 会社詳細＝200（設定フラグ＋account_count）／不明は 404。根拠 B.1。"""
    _login_system_admin(client)
    created = client.post(COMPANIES, json=_new_company_body(), headers=_csrf(client)).json()
    cid = created["company_id"]
    companies.append(uuid.UUID(cid))

    r = client.get(f"{COMPANIES}/{cid}")
    assert r.status_code == 200
    for k in ("mfa_required", "vote_anonymized", "hide_voters_from_managers", "account_count"):
        assert k in r.json()

    assert client.get(f"{COMPANIES}/{uuid.uuid4()}").status_code == 404


def test_b_tc_054_settings_integrity_and_profile(client, companies):
    """B-TC-054 設定 PATCH＝記名（vote_anonymized=false）時は hide_voters_from_managers を無効化。根拠 B.1。"""
    _login_system_admin(client)
    created = client.post(COMPANIES, json=_new_company_body(), headers=_csrf(client)).json()
    cid = created["company_id"]
    companies.append(uuid.UUID(cid))

    r = client.patch(f"{COMPANIES}/{cid}/settings",
                     json={"vote_anonymized": False, "hide_voters_from_managers": True},
                     headers=_csrf(client))
    assert r.status_code == 200
    assert r.json()["vote_anonymized"] is False
    assert r.json()["hide_voters_from_managers"] is False   # 記名時はサーバーで無効化

    # プロフィール更新
    r2 = client.patch(f"{COMPANIES}/{cid}", json={"color": "#112233"}, headers=_csrf(client))
    assert r2.status_code == 200 and r2.json()["color"] == "#112233"


def test_b_tc_055_non_admin_forbidden(client, factory):
    """B-TC-055 会社管理 API は system_admin 専用＝general は 403。根拠 B.1。"""
    acc = factory.make_seed_company_account()
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    assert client.get(COMPANIES).status_code == 403


def _mk(client, companies, name: str, code: str) -> dict:
    """指定 name/code で会社を作成し掃除に登録（ソート検証用の決定的データ）。"""
    body = {"name": name, "company_code": code, "db_identifier": f"ideaquest_test_{code.lower()}"}
    r = client.post(COMPANIES, json=body, headers=_csrf(client))
    assert r.status_code == 201, r.text
    data = r.json()
    companies.append(uuid.UUID(data["company_id"]))
    return data


def _names(client, params: dict) -> list:
    r = client.get(COMPANIES, params=params)
    assert r.status_code == 200, r.text
    return [c["name"] for c in r.json()["data"]]


def test_b_tc_126_multi_sort_priority(client, companies):
    """B-TC-126 複数ソートはキー順に並ぶ（作成順でない）＋第1キー同値は第2キーで解決。根拠 §1.8.1①。"""
    _login_system_admin(client)
    t = uuid.uuid4().hex[:6].upper()
    _mk(client, companies, f"{t} c", f"TC{t}C")  # 作成順 c,a,b（name 昇順と異なる）
    _mk(client, companies, f"{t} a", f"TC{t}A")
    _mk(client, companies, f"{t} b", f"TC{t}B")
    assert _names(client, {"q": t, "sort": "name"}) == [f"{t} a", f"{t} b", f"{t} c"]
    assert _names(client, {"q": t, "sort": "-name"}) == [f"{t} c", f"{t} b", f"{t} a"]

    d = uuid.uuid4().hex[:6].upper()  # name 同値 → 第2キー company_code 降順で解決
    _mk(client, companies, f"{d} same", f"TD{d}A")
    _mk(client, companies, f"{d} same", f"TD{d}B")
    r = client.get(COMPANIES, params={"q": d, "sort": "name,-company_code"})
    assert r.status_code == 200, r.text
    assert [c["company_code"] for c in r.json()["data"]] == [f"TD{d}B", f"TD{d}A"]


def test_b_tc_127_sort_whitelist_422(client):
    """B-TC-127 ホワイトリスト外のソートキーは 422（列挙/注入耐性）。根拠 §1.8.1①。"""
    _login_system_admin(client)
    r = client.get(COMPANIES, params={"sort": "badcol"})
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "sort"
