"""会社アイコン画像（B.1・MinIO 署名URL）のテスト（API設計 B.1・§1.10）。

管理DB `companies.icon_image_path` を直接更新（会社DB 未整備＝suspended でも可）。読取は短TTL 署名URL
（生キーは応答に出さない）。ストレージは Fake（メモリ）に差し替え＝MinIO 非依存。/me/avatar-image（K.4）
と同流儀。作成→アイコン PUT の2段で会社を用意する。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_companies import _new_company_body
from tests.admin.test_admin_issue import _csrf

COMPANIES = "/api/v1/admin/companies"

# 最小の PNG（1x1・シグネチャのみで十分＝サーバーは MIME/サイズを見る）
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000154a24f0e0000000049454e44ae426082"
)


@pytest.fixture
def companies():
    ids: list = []
    yield ids
    with control_session() as s:
        for cid in ids:
            s.query(Company).filter_by(id=cid).delete()
        s.commit()


def _create_company(client, companies) -> dict:
    created = client.post(COMPANIES, json=_new_company_body(), headers=_csrf(client)).json()
    companies.append(uuid.UUID(created["company_id"]))
    return created


def test_b_tc_icon_put_sets_signed_url(client, companies, storage):
    """B-TC-icon-01 会社アイコン設定＝200＋署名URL、詳細・一覧にも署名URL（生キー直返しでない）。"""
    _login_system_admin(client)
    created = _create_company(client, companies)
    cid, code = created["company_id"], created["company_code"]

    r = client.put(f"{COMPANIES}/{cid}/icon-image",
                    files={"file": ("c.png", PNG, "image/png")}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    url = r.json()["icon_image_url"]
    assert url and url.startswith("https://minio.test/company-icons/")
    assert len(storage.objects) == 1  # Fake に保存された

    # 詳細・一覧が署名URL を返す（icon_image_path 生キーではない）
    assert client.get(f"{COMPANIES}/{cid}").json()["icon_image_url"].startswith("https://minio.test/company-icons/")
    row = next(c for c in client.get(f"{COMPANIES}?q={code}").json()["data"] if c["company_id"] == cid)
    assert row["icon_image_url"].startswith("https://minio.test/company-icons/")


def test_b_tc_icon_rejects_non_image(client, companies, storage):
    """B-TC-icon-02 画像以外は 422（MIME allowlist・§2.2⑧）＝保存されない。"""
    _login_system_admin(client)
    cid = _create_company(client, companies)["company_id"]
    r = client.put(f"{COMPANIES}/{cid}/icon-image",
                   files={"file": ("c.txt", b"hello", "text/plain")}, headers=_csrf(client))
    assert r.status_code == 422
    assert len(storage.objects) == 0


def test_b_tc_icon_delete_resets(client, companies, storage):
    """B-TC-icon-03 削除＝204、詳細の icon_image_url は None、旧オブジェクトも消える。冪等。"""
    _login_system_admin(client)
    cid = _create_company(client, companies)["company_id"]
    client.put(f"{COMPANIES}/{cid}/icon-image",
               files={"file": ("c.png", PNG, "image/png")}, headers=_csrf(client))
    assert len(storage.objects) == 1

    r = client.delete(f"{COMPANIES}/{cid}/icon-image", headers=_csrf(client))
    assert r.status_code == 204
    assert client.get(f"{COMPANIES}/{cid}").json()["icon_image_url"] is None
    assert len(storage.objects) == 0
    # 冪等（既に未設定でも 204）
    assert client.delete(f"{COMPANIES}/{cid}/icon-image", headers=_csrf(client)).status_code == 204


def test_b_tc_icon_not_found(client, storage):
    """B-TC-icon-04 不明会社は 404。"""
    _login_system_admin(client)
    r = client.put(f"{COMPANIES}/{uuid.uuid4()}/icon-image",
                   files={"file": ("c.png", PNG, "image/png")}, headers=_csrf(client))
    assert r.status_code == 404


def test_b_tc_icon_non_admin_forbidden(client, factory, storage):
    """B-TC-icon-05 会社アイコン EP は system_admin 専用＝general は 403。"""
    acc = factory.make_seed_company_account()  # ACME-01 配下の general
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    r = client.put(f"{COMPANIES}/{uuid.uuid4()}/icon-image",
                   files={"file": ("c.png", PNG, "image/png")}, headers=_csrf(client))
    assert r.status_code == 403
