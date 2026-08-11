"""会社のクエストグループ候補一覧 API のテスト（doc/テスト/B §4.6・API設計 B.3・system_admin）。

`GET /admin/companies/{company_id}/quest-groups`＝所属割当の候補一覧（クロステナント・system_admin）。
グループは会社DB へ直接 seed し teardown で物理削除。
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
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.conftest import SEED_COMPANY_CODE


def _company():
    with control_session() as s:
        c = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        return c.id, c.db_identifier


def _url(company_id) -> str:
    return f"/api/v1/admin/companies/{company_id}/quest-groups"


@pytest.fixture
def groups():
    """ACME-01 に quest_group を seed し teardown で物理削除。"""
    cid, db_id = _company()
    created: list[uuid.UUID] = []

    def make_group(name: str = "G") -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_id) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:8].upper()}", name=name))
            ts.commit()
        created.append(gid)
        return gid

    yield SimpleNamespace(cid=cid, db_id=db_id, make_group=make_group)

    with get_tenant_session(db_id) as ts:
        for gid in created:
            ts.query(QuestGroupMember).filter_by(quest_group_id=gid).delete()
        for gid in created:
            ts.query(QuestGroup).filter_by(id=gid).delete()
        ts.commit()


def test_b_tc_086_system_admin_lists_quest_groups(client, groups):
    """B-TC-086 system_admin が会社の quest_groups 候補一覧を取得＝200＋member_count／不明会社は 404。"""
    _login_system_admin(client)
    g1 = groups.make_group(name="Alpha")

    r = client.get(_url(groups.cid))

    assert r.status_code == 200, r.text
    data = {g["group_id"]: g for g in r.json()["data"]}
    assert str(g1) in data
    assert data[str(g1)]["name"] == "Alpha" and "member_count" in data[str(g1)]

    assert client.get(_url(uuid.uuid4())).status_code == 404  # 不明会社は存在秘匿


def test_b_tc_087_authz(client, factory, groups):
    """B-TC-087 未認証は 401／general は 403（system_admin 専用・B.0.1）。"""
    assert client.get(_url(groups.cid)).status_code == 401
    acc = factory.make_seed_company_account()  # general
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    assert client.get(_url(groups.cid)).status_code == 403


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _cleanup_code(db_id: str, code: str) -> None:
    with get_tenant_session(db_id) as ts:
        ts.query(QuestGroup).filter_by(quest_group_code=code).delete()
        ts.commit()


def test_b_tc_088_create_quest_group(client, groups):
    """B-TC-088 system_admin がグループ作成＝201・code 大文字正規化・一覧に現れる（member_count=0）。B.3。"""
    _login_system_admin(client)
    code = f"qg-{uuid.uuid4().hex[:6]}"  # 小文字入力
    upper = code.upper()
    try:
        r = client.post(_url(groups.cid), json={"quest_group_code": code, "name": "Beta"},
                         headers=_csrf(client))
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["quest_group_code"] == upper  # 大文字正規化（§5.4）
        assert body["name"] == "Beta" and body["member_count"] == 0
        codes = {g["quest_group_code"] for g in client.get(_url(groups.cid)).json()["data"]}
        assert upper in codes
    finally:
        _cleanup_code(groups.db_id, upper)


def test_b_tc_089_create_validation_and_authz(client, factory, groups):
    """B-TC-089 既存 code 409／不正形式 422／不明会社 404／CSRF 無し 403／general 403（B.3・§5.4）。"""
    _login_system_admin(client)
    g1 = groups.make_group()  # 既存グループ（code を重複させる）
    with get_tenant_session(groups.db_id) as ts:
        existing_code = ts.query(QuestGroup).filter_by(id=g1).one().quest_group_code

    # 既存 code → 409
    r_dup = client.post(_url(groups.cid), json={"quest_group_code": existing_code, "name": "X"},
                        headers=_csrf(client))
    assert r_dup.status_code == 409 and r_dup.json()["errors"][0]["field"] == "quest_group_code"
    # 不正形式（先頭数字・短すぎ）→ 422
    assert client.post(_url(groups.cid), json={"quest_group_code": "1a", "name": "X"},
                       headers=_csrf(client)).status_code == 422
    # 不明会社 → 404
    assert client.post(_url(uuid.uuid4()), json={"quest_group_code": "ABCD", "name": "X"},
                       headers=_csrf(client)).status_code == 404
    # CSRF 無し → 403
    assert client.post(_url(groups.cid), json={"quest_group_code": "ABCD", "name": "X"}).status_code == 403
    # general → 403
    acc = factory.make_seed_company_account()
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    assert client.post(_url(groups.cid), json={"quest_group_code": "ABCD", "name": "X"},
                       headers=_csrf(client)).status_code == 403


def _group_url(cid, gid) -> str:
    return f"/api/v1/admin/companies/{cid}/quest-groups/{gid}"


def _seed_active_member(db_id: str, group_id, account_id) -> None:
    with get_tenant_session(db_id) as ts:
        uid = get_user_by_account(ts, account_id).id
        ts.add(QuestGroupMember(id=uuid.uuid4(), quest_group_id=group_id, user_id=uid, role="member"))
        ts.commit()


def test_b_tc_090_rename_quest_group(client, groups):
    """B-TC-090 リネーム＝name 更新・quest_group_code は不変。不明 group は 404（B.3.1）。"""
    _login_system_admin(client)
    g1 = groups.make_group(name="Before")
    with get_tenant_session(groups.db_id) as ts:
        code_before = ts.query(QuestGroup).filter_by(id=g1).one().quest_group_code

    r = client.patch(_group_url(groups.cid, g1), json={"name": "After"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "After" and r.json()["quest_group_code"] == code_before

    assert client.patch(_group_url(groups.cid, uuid.uuid4()), json={"name": "X"},
                        headers=_csrf(client)).status_code == 404


def test_b_tc_091_delete_empty_group_tombstone(client, groups):
    """B-TC-091 空グループ削除＝204・一覧から消える（tombstone）・同 code を再作成できる（部分ユニーク）。"""
    _login_system_admin(client)
    g1 = groups.make_group()
    with get_tenant_session(groups.db_id) as ts:
        code = ts.query(QuestGroup).filter_by(id=g1).one().quest_group_code

    r = client.delete(_group_url(groups.cid, g1), headers=_csrf(client))
    assert r.status_code == 204, r.text
    codes = {g["quest_group_code"] for g in client.get(_url(groups.cid)).json()["data"]}
    assert code not in codes  # 一覧から消える（deleted_at IS NULL 絞り）

    try:  # 同一コードを再作成できる（有効行の部分ユニーク）
        r2 = client.post(_url(groups.cid), json={"quest_group_code": code, "name": "Reborn"},
                         headers=_csrf(client))
        assert r2.status_code == 201, r2.text
    finally:
        _cleanup_code(groups.db_id, code)  # 再作成分（有効行）を掃除


def test_b_tc_092_delete_in_use_conflict(client, factory, groups):
    """B-TC-092 有効所属を持つグループの削除は 409 conflict（in_use）＝空のみ削除可（B.3.1）。"""
    _login_system_admin(client)
    g1 = groups.make_group()
    member = factory.make_seed_company_account()
    _seed_active_member(groups.db_id, g1, member["id"])

    r = client.delete(_group_url(groups.cid, g1), headers=_csrf(client))
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "conflict"


def test_b_tc_093_rename_delete_authz(client, factory, groups):
    """B-TC-093 PATCH/DELETE は system_admin 専用＋CSRF 必須（未認証 401／general 403／CSRF 無し 403）。"""
    g1 = groups.make_group()
    # 未認証
    assert client.patch(_group_url(groups.cid, g1), json={"name": "X"}).status_code == 401
    assert client.delete(_group_url(groups.cid, g1)).status_code == 401
    # system_admin だが CSRF 無し
    _login_system_admin(client)
    assert client.patch(_group_url(groups.cid, g1), json={"name": "X"}).status_code == 403
    assert client.delete(_group_url(groups.cid, g1)).status_code == 403
    # general（CSRF 有り）→ 403
    acc = factory.make_seed_company_account()
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    assert client.patch(_group_url(groups.cid, g1), json={"name": "X"}, headers=_csrf(client)).status_code == 403
    assert client.delete(_group_url(groups.cid, g1), headers=_csrf(client)).status_code == 403
