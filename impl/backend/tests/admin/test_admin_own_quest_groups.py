"""会社アカウント管理者による自社クエストグループ CRUD のテスト（doc/テスト/B §4.7・API設計 B.2.1・2026-09-06 委任）。

`POST/PATCH/DELETE /admin/company-quest-groups[/{group_id}]`＝セッション会社固定・`require_company_account_admin`。
グループは会社DB へ直接 seed し teardown で物理削除。system_admin のクロステナント経路（B.3.1）は別テスト。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from tests.admin.test_admin_accounts import _login
from tests.admin.test_admin_self import _login_company_admin
from tests.conftest import SEED_COMPANY_CODE

BASE = "/api/v1/admin/company-quest-groups"


def _company():
    with control_session() as s:
        c = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        return c.id, c.db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def groups():
    """ACME-01 に quest_group を seed し teardown で物理削除（作成テスト分は code で追加掃除）。"""
    _, db_id = _company()
    created: list[uuid.UUID] = []
    codes: list[str] = []

    def make_group(name: str = "G") -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_id) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:8].upper()}", name=name))
            ts.commit()
        created.append(gid)
        return gid

    def track_code(code: str) -> None:
        codes.append(code)

    yield SimpleNamespace(db_id=db_id, make_group=make_group, track_code=track_code)

    with get_tenant_session(db_id) as ts:
        for gid in created:
            ts.query(QuestGroupMember).filter_by(quest_group_id=gid).delete()
        for gid in created:
            ts.query(QuestGroup).filter_by(id=gid).delete()
        for code in codes:
            ts.query(QuestGroup).filter_by(quest_group_code=code).delete()
        ts.commit()


def _seed_active_member(db_id: str, group_id, account_id) -> None:
    with get_tenant_session(db_id) as ts:
        uid = get_user_by_account(ts, account_id).id
        ts.add(QuestGroupMember(id=uuid.uuid4(), quest_group_id=group_id, user_id=uid, role="member"))
        ts.commit()


# --- B-TC-172: 会社アカ管理者が自社グループを作成 -----------------------------------
def test_b_tc_172_company_admin_creates_own_quest_group(client, factory, groups):
    """B-TC-172 会社アカ管理者が自社グループ作成＝201・code 大文字正規化・一覧に現れる／重複409／形式422。B.2.1。"""
    _login_company_admin(client, factory)
    code = f"qgself-{uuid.uuid4().hex[:6]}"  # 小文字入力
    upper = code.upper()
    groups.track_code(upper)

    r = client.post(BASE, json={"quest_group_code": code, "name": "Beta"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["quest_group_code"] == upper  # 大文字正規化（§5.4）
    assert body["name"] == "Beta" and body["member_count"] == 0

    codes = {g["quest_group_code"] for g in client.get(BASE).json()["data"]}
    assert upper in codes

    # 既存 code → 409（field=quest_group_code）
    r_dup = client.post(BASE, json={"quest_group_code": code, "name": "X"}, headers=_csrf(client))
    assert r_dup.status_code == 409 and r_dup.json()["errors"][0]["field"] == "quest_group_code"
    # 不正形式 → 422
    assert client.post(BASE, json={"quest_group_code": "1a", "name": "X"}, headers=_csrf(client)).status_code == 422


# --- B-TC-173: リネーム（name のみ・code 不変） ------------------------------------
def test_b_tc_173_company_admin_renames_own_quest_group(client, factory, groups):
    """B-TC-173 会社アカ管理者のリネーム＝name 更新・quest_group_code 不変・不明 group は 404。B.2.1。"""
    _login_company_admin(client, factory)
    g1 = groups.make_group(name="Before")
    with get_tenant_session(groups.db_id) as ts:
        code_before = ts.query(QuestGroup).filter_by(id=g1).one().quest_group_code

    r = client.patch(f"{BASE}/{g1}", json={"name": "After"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "After" and r.json()["quest_group_code"] == code_before

    assert client.patch(f"{BASE}/{uuid.uuid4()}", json={"name": "X"}, headers=_csrf(client)).status_code == 404


# --- B-TC-174: 空削除（tombstone）と使用中拒否 ------------------------------------
def test_b_tc_174_company_admin_deletes_empty_and_rejects_in_use(client, factory, groups):
    """B-TC-174 空グループ削除＝204で一覧から消える／有効所属ありは 409 conflict（in_use）。B.2.1／§5.5。"""
    _login_company_admin(client, factory)

    empty = groups.make_group()
    with get_tenant_session(groups.db_id) as ts:
        code = ts.query(QuestGroup).filter_by(id=empty).one().quest_group_code
    r = client.delete(f"{BASE}/{empty}", headers=_csrf(client))
    assert r.status_code == 204, r.text
    codes = {g["quest_group_code"] for g in client.get(BASE).json()["data"]}
    assert code not in codes

    in_use = groups.make_group()
    member = factory.make_seed_company_account()
    _seed_active_member(groups.db_id, in_use, member["id"])
    r_used = client.delete(f"{BASE}/{in_use}", headers=_csrf(client))
    assert r_used.status_code == 409 and r_used.json()["code"] == "conflict"


# --- B-TC-175: 認可・CSRF・クロステナント遮断 -------------------------------------
def test_b_tc_175_authz_csrf_and_cross_tenant(client, factory, groups):
    """B-TC-175 未認証401／general403／CSRF無し403／他社 group_id は自社DB解決で 404（IDOR 遮断）。B.0.1/B.2.1。"""
    g1 = groups.make_group()

    # 未認証
    assert client.post(BASE, json={"quest_group_code": "ABCD", "name": "X"}).status_code == 401
    assert client.patch(f"{BASE}/{g1}", json={"name": "X"}).status_code == 401
    assert client.delete(f"{BASE}/{g1}").status_code == 401

    # general（CSRF 有り）→ 403
    acc = factory.make_seed_company_account()
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    assert client.post(BASE, json={"quest_group_code": "ABCD", "name": "X"}, headers=_csrf(client)).status_code == 403

    # 会社アカ管理者だが CSRF 無し → 403
    _login_company_admin(client, factory)
    assert client.post(BASE, json={"quest_group_code": "ABCD", "name": "X"}).status_code == 403
    assert client.patch(f"{BASE}/{g1}", json={"name": "X"}).status_code == 403
    assert client.delete(f"{BASE}/{g1}").status_code == 403

    # 他社（存在しない/範囲外）の group_id → 自社DBで解決され 404
    assert client.patch(f"{BASE}/{uuid.uuid4()}", json={"name": "X"}, headers=_csrf(client)).status_code == 404
    assert client.delete(f"{BASE}/{uuid.uuid4()}", headers=_csrf(client)).status_code == 404
