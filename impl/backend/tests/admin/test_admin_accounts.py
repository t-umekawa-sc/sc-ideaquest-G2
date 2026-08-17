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


# --- §1.8.1 DataTable クエリ契約の横展開（B.2・会社の B-TC-126〜135 に対応するアカウント版） ------
# 会社一覧EP（company_application）で実証した契約を list_query 共通パーサ経由でアカウント一覧へ展開。
# 検証用データは factory の専用会社＋アカウント（管理DBのみ・会社DB不要）で決定的に作る。


def test_b_tc_141_multi_sort_by_display_name(client, factory):
    """B-TC-141 複数ソート（§1.8.1①）＝?sort=display_name で氏名昇順・- 接頭辞で降順。"""
    _login_system_admin(client)
    co = factory.make_company()
    factory.make_account(co, display_name="Charlie")
    factory.make_account(co, display_name="Alice")
    factory.make_account(co, display_name="Bob")

    r = client.get(_url(co["id"], "?sort=display_name"))
    assert r.status_code == 200, r.text
    assert [a["display_name"] for a in r.json()["data"]] == ["Alice", "Bob", "Charlie"]

    r2 = client.get(_url(co["id"], "?sort=-display_name"))
    assert r2.status_code == 200, r2.text
    assert [a["display_name"] for a in r2.json()["data"]] == ["Charlie", "Bob", "Alice"]


def test_b_tc_142_unknown_sort_key_422(client, factory):
    """B-TC-142 ソートキーはホワイトリスト＝未知キーは 422 validation_error(field=sort)（§1.8.1①・§2.2）。"""
    _login_system_admin(client)
    co = factory.make_company()
    r = client.get(_url(co["id"], "?sort=password_hash"))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "sort"


def test_b_tc_143_enum_status_multi(client, factory):
    """B-TC-143 enum 多値フィルタ（§1.8.1②）＝?status=active,disabled は OR。単値も可。"""
    _login_system_admin(client)
    co = factory.make_company()
    factory.make_account(co, status="active", display_name="ActiveOne")
    factory.make_account(co, status="disabled", display_name="DisabledOne")

    only_disabled = client.get(_url(co["id"], "?status=disabled")).json()["data"]
    assert [a["display_name"] for a in only_disabled] == ["DisabledOne"]

    both = client.get(_url(co["id"], "?status=active,disabled&sort=display_name")).json()["data"]
    assert [a["display_name"] for a in both] == ["ActiveOne", "DisabledOne"]


def test_b_tc_144_unknown_status_enum_422(client, factory):
    """B-TC-144 enum 未知値は 422 validation_error(field=status)（ホワイトリスト・§2.2）。"""
    _login_system_admin(client)
    co = factory.make_company()
    r = client.get(_url(co["id"], "?status=bogus"))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "status"


def test_b_tc_145_enum_system_role_multi(client, factory):
    """B-TC-145 system_role の enum 多値フィルタ（§1.8.1②・B.2）。"""
    _login_system_admin(client)
    co = factory.make_company()
    factory.make_account(co, system_role="general", display_name="Gen")
    factory.make_account(co, system_role="company_account_admin", display_name="Adm")

    only_admin = client.get(_url(co["id"], "?system_role=company_account_admin")).json()["data"]
    assert [a["display_name"] for a in only_admin] == ["Adm"]


def test_b_tc_146_unknown_system_role_enum_422(client, factory):
    """B-TC-146 system_role の未知値は 422 validation_error(field=system_role)。"""
    _login_system_admin(client)
    co = factory.make_company()
    r = client.get(_url(co["id"], "?system_role=root"))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "system_role"


def test_b_tc_147_pin_resolves_across_filter(client, factory):
    """B-TC-147 固定行のページ/絞込跨ぎ解決（§1.8.1④）＝pin_ids は絞込外でも pinned に必ず返る・data から除外。"""
    _login_system_admin(client)
    co = factory.make_company()
    a_active = factory.make_account(co, status="active", display_name="PinnedActive")
    factory.make_account(co, status="disabled", display_name="D1")
    factory.make_account(co, status="disabled", display_name="D2")

    r = client.get(_url(co["id"], f"?status=disabled&pin_ids={a_active['id']}"))
    assert r.status_code == 200, r.text
    body = r.json()
    # 固定行は絞込（status=disabled）に関係なく解決される。
    assert [a["display_name"] for a in body["pinned"]] == ["PinnedActive"]
    # data は非固定母集合（絞込適用）＝固定した active は含めない。
    data_names = [a["display_name"] for a in body["data"]]
    assert "PinnedActive" not in data_names
    assert set(data_names) == {"D1", "D2"}
    assert body["page_info"]["total"] == 2  # 非固定母集合のみ


def test_b_tc_148_pin_ids_invalid_format_422(client, factory):
    """B-TC-148 pin_ids の形式検証（§1.8.1④）＝不正 UUID は 422 validation_error(field=pin_ids)。"""
    _login_system_admin(client)
    co = factory.make_company()
    r = client.get(_url(co["id"], "?pin_ids=not-a-uuid"))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "pin_ids"


def _audit_rows(action: str):
    from app.control_plane.audit.orm import SystemAuditLog
    with control_session() as s:
        return s.query(SystemAuditLog).filter_by(action=action).all()


def test_b_tc_149_csv_export(client, factory):
    """B-TC-149 CSV エクスポート（§1.8.1③）＝text/csv・UTF-8 BOM・表示列/列順・同条件の全件。"""
    _login_system_admin(client)
    co = factory.make_company()
    factory.make_account(co, display_name="Zoe", status="disabled")
    factory.make_account(co, display_name="Amy", status="active")

    r = client.get(_url(co["id"], "?format=csv&columns=display_name,status&sort=display_name"))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM（Excel 互換）
    lines = r.content.decode("utf-8-sig").splitlines()
    assert lines[0] == "氏名,状態"                  # 表示列ラベル・列順
    assert lines[1].split(",") == ["Amy", "active"]     # sort=display_name 昇順
    assert lines[2].split(",") == ["Zoe", "disabled"]
    assert len(lines) == 3                          # header + 全件（ページング無視）


def test_b_tc_150_csv_export_audited(client, factory):
    """B-TC-150 管理系 CSV エクスポートは監査記録（account.export・件数）（§1.8.1③／B.6）。"""
    _login_system_admin(client)
    co = factory.make_company()
    factory.make_account(co, display_name="Solo")
    r = client.get(_url(co["id"], "?format=csv"))
    assert r.status_code == 200, r.text
    rows = _audit_rows("account.export")
    assert len(rows) == 1
    assert rows[0].detail["count"] == 1


def test_b_tc_151_csv_columns_whitelist_422(client, factory):
    """B-TC-151 CSV 列のホワイトリスト外は 422 validation_error(field=columns)（§1.8.1③）。"""
    _login_system_admin(client)
    co = factory.make_company()
    r = client.get(_url(co["id"], "?format=csv&columns=display_name,bogus"))
    assert r.status_code == 422, r.text
    assert r.json()["errors"][0]["field"] == "columns"
