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
