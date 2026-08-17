"""会社 CRUD API のテスト（doc/テスト/B_会社・アカウント.md §3・API設計 B.1）。

`/admin/companies`（system_admin・SC-91/92）。作成は status=suspended、code は大文字正規化＋一意、
設定 PATCH は記名時に投票者非開示を無効化して整合。作成会社は `companies` フィクスチャで掃除。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.audit.orm import SystemAuditLog
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


def test_b_tc_128_enum_multi_filter(client, companies):
    """B-TC-128 enum フィルタは多値 OR（status=a,b は和集合）。根拠 §1.8.1②。"""
    _login_system_admin(client)
    t = uuid.uuid4().hex[:6].upper()
    a = _mk(client, companies, f"{t} act", f"TE{t}A")
    _mk(client, companies, f"{t} sus", f"TE{t}S")
    with control_session() as sess:  # 作成は suspended 固定のため片方を active に（状態を用意）
        sess.query(Company).filter_by(id=uuid.UUID(a["company_id"])).update({"status": "active"})
        sess.commit()

    def codes(st):
        r = client.get(COMPANIES, params={"q": t, "status": st})
        assert r.status_code == 200, r.text
        return sorted(c["company_code"] for c in r.json()["data"])

    assert codes("active") == [f"TE{t}A"]
    assert codes("suspended") == [f"TE{t}S"]
    both = client.get(COMPANIES, params={"q": t, "status": "active,suspended"})
    assert both.status_code == 200, both.text
    assert sorted(c["company_code"] for c in both.json()["data"]) == [f"TE{t}A", f"TE{t}S"]
    assert both.json()["page_info"]["total"] == 2  # total も多値フィルタを反映


def test_b_tc_129_enum_whitelist_422(client):
    """B-TC-129 未知の enum 値は 422（ホワイトリスト）。根拠 §1.8.1②。"""
    _login_system_admin(client)
    r = client.get(COMPANIES, params={"status": "bogus"})
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "status"


def test_b_tc_130_number_range_filter(client, companies):
    """B-TC-130 number 範囲フィルタ（account_count の _min/_max）。根拠 §1.8.1②。"""
    _login_system_admin(client)
    t = uuid.uuid4().hex[:6].upper()
    for i in range(3):
        _mk(client, companies, f"{t} n{i}", f"TN{t}{i}")  # account_count=0

    r_min = client.get(COMPANIES, params={"q": t, "account_count_min": 1})
    assert r_min.status_code == 200, r_min.text
    assert r_min.json()["page_info"]["total"] == 0   # 0件（全て count=0）

    r_max = client.get(COMPANIES, params={"q": t, "account_count_max": 0})
    assert r_max.status_code == 200, r_max.text
    assert r_max.json()["page_info"]["total"] == 3   # 全件


def _audit_rows(action: str) -> list:
    with control_session() as s:
        return list(s.query(SystemAuditLog).filter_by(action=action).all())


def test_b_tc_131_csv_export(client, companies):
    """B-TC-131 CSV エクスポート＝text/csv・BOM・表示列/列順・同条件の全件。根拠 §1.8.1③。"""
    _login_system_admin(client)
    t = uuid.uuid4().hex[:6].upper()
    _mk(client, companies, f"{t} b", f"TF{t}B")   # 作成順 b,a（sort=name で並べ替わる）
    _mk(client, companies, f"{t} a", f"TF{t}A")

    r = client.get(COMPANIES, params={"q": t, "format": "csv",
                                      "columns": "name,company_code", "sort": "name"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")   # UTF-8 BOM（Excel 互換）
    lines = r.content.decode("utf-8-sig").splitlines()
    assert lines[0] == "会社名,会社コード"          # 表示列ラベル・列順
    assert lines[1].split(",") == [f"{t} a", f"TF{t}A"]   # sort=name 昇順
    assert lines[2].split(",") == [f"{t} b", f"TF{t}B"]
    assert len(lines) == 3                          # header + 全件（ページング無視・q で isolate）


def test_b_tc_132_csv_export_audited(client, companies):
    """B-TC-132 管理系 CSV エクスポートは監査記録（company.export・件数）。根拠 §1.8.1③／B.6。"""
    _login_system_admin(client)
    t = uuid.uuid4().hex[:6].upper()
    _mk(client, companies, f"{t} x", f"TG{t}X")
    r = client.get(COMPANIES, params={"q": t, "format": "csv"})
    assert r.status_code == 200, r.text
    rows = _audit_rows("company.export")
    assert len(rows) == 1
    assert rows[0].detail["count"] == 1


def test_b_tc_133_csv_columns_whitelist_422(client):
    """B-TC-133 CSV 列のホワイトリスト外は 422。根拠 §1.8.1③。"""
    _login_system_admin(client)
    r = client.get(COMPANIES, params={"format": "csv", "columns": "name,bogus"})
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "columns"


def test_b_tc_134_pins_resolved_across_filter(client, companies):
    """B-TC-134 ピン行は絞込で母集合から外れても必ず解決して返す（data からは除外）。根拠 §1.8.1④。"""
    _login_system_admin(client)
    t = uuid.uuid4().hex[:6].upper()
    p = _mk(client, companies, f"{t} pinned", f"TP{t}P")
    _mk(client, companies, f"{t} a", f"TP{t}A")
    _mk(client, companies, f"{t} b", f"TP{t}B")
    with control_session() as sess:  # ピン対象を active に（status=suspended 絞込から外す）
        sess.query(Company).filter_by(id=uuid.UUID(p["company_id"])).update({"status": "active"})
        sess.commit()

    r = client.get(COMPANIES, params={"q": t, "status": "suspended", "pin_ids": p["company_id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pinned" in body, body
    assert [c["company_code"] for c in body["pinned"]] == [f"TP{t}P"]      # 絞込外でも解決
    data_codes = [c["company_code"] for c in body["data"]]
    assert f"TP{t}P" not in data_codes                                     # data からは除外
    assert sorted(data_codes) == [f"TP{t}A", f"TP{t}B"]
    assert body["page_info"]["total"] == 2                                 # 母集合＝非固定のみ


def test_b_tc_135_pin_ids_malformed_422(client):
    """B-TC-135 不正な pin_ids は 422。根拠 §1.8.1④。"""
    _login_system_admin(client)
    r = client.get(COMPANIES, params={"pin_ids": "not-a-uuid"})
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "pin_ids"
