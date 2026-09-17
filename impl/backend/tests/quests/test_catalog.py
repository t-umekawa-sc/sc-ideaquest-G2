"""C-TC-260〜265: 発見カタログ・フォロー・参加リクエスト（FR-40・C.9・SC-13）。

seed 一般ユーザー（ACME-01・viewer）でログインし、他ユーザー owner の discoverable クエストを会社DB に seed。
発見門番（discoverable ∧ 部署交差／0件=全社）・my_state・follow/join-request と通知を検証。teardown で物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import (
    Quest, QuestFollow, QuestGroupLink, QuestJoinRequest, QuestMember, QuestMemberPermission,
)
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

CATALOG = "/api/v1/quest-catalog"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def env():
    with control_session() as s:
        db = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db) as ts:
        viewer_id = get_user_by_account(ts, account.id).id

    g_in, g_out = uuid.uuid4(), uuid.uuid4()   # viewer が所属する部署 / しない部署
    owner_id = uuid.uuid4()
    quests: list[uuid.UUID] = []

    def new_quest(*, discoverable, group=None, status="recruiting", zero_dept=False) -> uuid.UUID:
        qid = uuid.uuid4()
        with get_tenant_session(db) as ts:
            repo.create_quest(ts, quest_id=qid, owner_id=owner_id, title="Cat", color="#3B82F6", status=status)
            if not zero_dept:
                repo.create_group_links(ts, qid, group_ids=[group or g_in])
            repo.add_member(ts, qid, owner_id, permissions=["owner"])
            q = ts.get(Quest, qid)
            q.discoverable = discoverable
            ts.commit()
        quests.append(qid)
        return qid

    with get_tenant_session(db) as ts:
        ts.add(User(id=owner_id, account_id=uuid.uuid4(), display_name="Owner", locale="ja", status="active"))
        ts.add(QuestGroup(id=g_in, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="In"))
        ts.add(QuestGroup(id=g_out, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="Out"))
        ts.flush()
        qg_repo.upsert_membership(ts, g_in, viewer_id)   # viewer は g_in のみ所属
        qg_repo.upsert_membership(ts, g_in, owner_id)
        ts.commit()

    yield SimpleNamespace(db=db, viewer_id=viewer_id, owner_id=owner_id, g_in=g_in, g_out=g_out,
                          new_quest=new_quest, quests=quests)

    with get_tenant_session(db) as ts:
        qids = list(quests)
        ts.execute(Notification.__table__.delete().where(Notification.ref_quest_id.in_(qids)))
        ts.execute(QuestFollow.__table__.delete().where(QuestFollow.quest_id.in_(qids)))
        ts.execute(QuestJoinRequest.__table__.delete().where(QuestJoinRequest.quest_id.in_(qids)))
        mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(qids))).scalars())
        if mids:
            ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(qids)))
        ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id.in_(qids)))
        ts.execute(Quest.__table__.delete().where(Quest.id.in_(qids)))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id.in_([g_in, g_out])))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id.in_([g_in, g_out])))
        ts.execute(User.__table__.delete().where(User.id == owner_id))
        ts.commit()


def _catalog_ids(client):
    return {c["id"] for c in client.get(CATALOG).json()["data"]}


def test_c_tc_260_catalog_gate(client, env):
    """C-TC-260 発見門番＝discoverable ∧ 部署交差（0件=全社）。非discoverable/別部署は出ない・my_state=none。"""
    visible = env.new_quest(discoverable=True, group=env.g_in)       # 出る
    hidden_flag = env.new_quest(discoverable=False, group=env.g_in)  # 非discoverable→出ない
    other_dept = env.new_quest(discoverable=True, group=env.g_out)   # 別部署→出ない
    company_wide = env.new_quest(discoverable=True, zero_dept=True)  # 参加部署0件＝全社→出る
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    body = client.get(CATALOG).json()
    ids = {c["id"] for c in body["data"]}
    assert str(visible) in ids and str(company_wide) in ids
    assert str(hidden_flag) not in ids and str(other_dept) not in ids
    card = next(c for c in body["data"] if c["id"] == str(visible))
    assert card["my_state"] == "none" and "purpose" in card  # メタ（中身は返さない）
    assert "page_info" in body and body["page_info"]["total"] >= 2


def test_c_tc_261_follow_toggle(client, env):
    """C-TC-261 フォロー→my_state=following／解除→none（冪等・C.9）。"""
    qid = env.new_quest(discoverable=True)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(f"/api/v1/quests/{qid}/follow", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["following"] is True
    card = next(c for c in client.get(CATALOG).json()["data"] if c["id"] == str(qid))
    assert card["my_state"] == "following"
    r2 = client.delete(f"/api/v1/quests/{qid}/follow", headers=_csrf(client))
    assert r2.status_code == 200 and r2.json()["following"] is False
    card2 = next(c for c in client.get(CATALOG).json()["data"] if c["id"] == str(qid))
    assert card2["my_state"] == "none"


def test_c_tc_262_join_request_and_notify(client, env):
    """C-TC-262 参加リクエスト→my_state=pending＋作成者へ join_request_received 通知／重複409／取消→none。"""
    qid = env.new_quest(discoverable=True)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(f"/api/v1/quests/{qid}/join-request", json={"message": "参加したい"}, headers=_csrf(client))
    assert r.status_code == 201 and r.json()["status"] == "pending", r.text
    card = next(c for c in client.get(CATALOG).json()["data"] if c["id"] == str(qid))
    assert card["my_state"] == "pending"
    # 作成者へ join_request_received 通知（post-commit）。
    with get_tenant_session(env.db) as ts:
        n = ts.execute(select(Notification).where(
            Notification.recipient_id == env.owner_id, Notification.ref_quest_id == qid,
            Notification.type == "join_request_received")).scalars().all()
        assert len(n) == 1
    # 重複申請は 409。
    dup = client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client))
    assert dup.status_code == 409
    # 取り下げ→ my_state=none。
    w = client.delete(f"/api/v1/quests/{qid}/join-request", headers=_csrf(client))
    assert w.status_code == 204
    card2 = next(c for c in client.get(CATALOG).json()["data"] if c["id"] == str(qid))
    assert card2["my_state"] == "none"


def test_c_tc_263_gate_and_member_guard(client, env):
    """C-TC-263 非discoverable への follow/join は 404（存在秘匿）／既 member への join は 409。"""
    hidden = env.new_quest(discoverable=False)
    joined = env.new_quest(discoverable=True)
    with get_tenant_session(env.db) as ts:
        repo.add_member(ts, joined, env.viewer_id, permissions=["comment"])  # viewer を member に
        ts.commit()
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{hidden}/follow", headers=_csrf(client)).status_code == 404
    assert client.post(f"/api/v1/quests/{hidden}/join-request", json={}, headers=_csrf(client)).status_code == 404
    r = client.post(f"/api/v1/quests/{joined}/join-request", json={}, headers=_csrf(client))
    assert r.status_code == 409  # already_member
    # member のクエストはカタログでも my_state=member。
    card = next((c for c in client.get(CATALOG).json()["data"] if c["id"] == str(joined)), None)
    assert card is not None and card["my_state"] == "member"


def test_c_tc_264_catalog_detail_and_sort_422(client, env):
    """C-TC-264 catalog-detail は発見門番のみ（非discoverable 404）／未知 sort キーは 422。"""
    visible = env.new_quest(discoverable=True)
    hidden = env.new_quest(discoverable=False)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(f"/api/v1/quests/{visible}/catalog-detail").status_code == 200
    assert client.get(f"/api/v1/quests/{hidden}/catalog-detail").status_code == 404
    assert client.get(CATALOG, params={"sort": "bogus"}).status_code == 422
    assert client.get(CATALOG, params={"sort": "-created_at"}).status_code == 200
