"""C-TC-260〜265: 発見カタログ・フォロー・参加リクエスト（FR-40・C.9・SC-13）。

seed 一般ユーザー（ACME-01・viewer）でログインし、他ユーザー owner の discoverable クエストを会社DB に seed。
発見門番（discoverable ∧ 部署交差／0件=全社）・my_state・follow/join-request と通知を検証。teardown で物理削除。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat.orm import ChatGroup, ChatMessage
from app.tenant.gamification.orm import Activity
from app.tenant.ideas.orm import Idea, IdeaRevision
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as repo
from app.tenant.quests.orm import (
    Quest, QuestCategory, QuestFollow, QuestGroupLink, QuestJoinRequest, QuestMember, QuestMemberPermission,
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
    extra_users: list[uuid.UUID] = []          # テスト内で足した申請者などの掃除対象

    def new_quest(*, discoverable, group=None, status="recruiting", zero_dept=False, owner=None) -> uuid.UUID:
        qid = uuid.uuid4()
        oid = owner or owner_id
        with get_tenant_session(db) as ts:
            repo.create_quest(ts, quest_id=qid, owner_id=oid, title="Cat", color="#3B82F6", status=status)
            if not zero_dept:
                repo.create_group_links(ts, qid, group_ids=[group or g_in])
            repo.add_member(ts, qid, oid, permissions=["owner"])
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
                          new_quest=new_quest, quests=quests, extra_users=extra_users)

    with get_tenant_session(db) as ts:
        qids = list(quests)
        # C-TC-265 で作った公開アイデア＋チャット（横断活発度）の後始末（Quest 削除前に FK 解消）。
        iids = list(ts.execute(select(Idea.id).where(Idea.quest_id.in_(qids))).scalars())
        if iids:
            cgids = list(ts.execute(select(ChatGroup.id).where(ChatGroup.idea_id.in_(iids))).scalars())
            if cgids:
                ts.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_group_id.in_(cgids)))
                ts.execute(ChatGroup.__table__.delete().where(ChatGroup.id.in_(cgids)))
            ts.execute(IdeaRevision.__table__.delete().where(IdeaRevision.idea_id.in_(iids)))  # 公開時の版（C-TC-281）
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(iids)))
        ts.execute(Notification.__table__.delete().where(Notification.ref_quest_id.in_(qids)))
        ts.execute(QuestFollow.__table__.delete().where(QuestFollow.quest_id.in_(qids)))
        ts.execute(QuestJoinRequest.__table__.delete().where(QuestJoinRequest.quest_id.in_(qids)))
        ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(qids)))  # API 作成分（C-TC-276）
        ts.execute(Activity.__table__.delete().where(Activity.quest_id.in_(qids)))  # 完了/公開のゲーム活動（C-TC-281）
        mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(qids))).scalars())
        if mids:
            ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(qids)))
        ts.execute(QuestGroupLink.__table__.delete().where(QuestGroupLink.quest_id.in_(qids)))
        ts.execute(Quest.__table__.delete().where(Quest.id.in_(qids)))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id.in_([g_in, g_out])))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id.in_([g_in, g_out])))
        ts.execute(User.__table__.delete().where(User.id.in_([owner_id, *extra_users])))
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
    # 番号ページャ分岐（page/per_page 指定）＝offset パス（未指定=全件とは別経路）。
    paged = client.get(CATALOG, params={"page": 1, "per_page": 5})
    assert paged.status_code == 200, paged.text
    pi = paged.json()["page_info"]
    assert pi["page"] == 1 and pi["per_page"] == 5 and "total" in pi


def test_c_tc_265_catalog_detail_activity(client, env):
    """C-TC-265 catalog-detail の活発度スパーク＝クエスト横断（公開アイデアのチャット合算）・メタのみ・本文非返却。"""
    qid = env.new_quest(discoverable=True)
    now = datetime.now(timezone.utc)
    # 公開アイデア2件＋各チャット群にメッセージ（別日）を seed。合計 3 件（2件目に2メッセージ・別日）。
    with get_tenant_session(env.db) as ts:
        secret = "SECRET_CHAT_BODY_SHOULD_NOT_LEAK"
        for n in range(2):
            iid = uuid.uuid4()
            ts.add(Idea(id=iid, quest_id=qid, author_id=env.owner_id, title=f"I{n}",
                        body="b", value="v", status="published"))
            ts.flush()
            cgid = uuid.uuid4()
            ts.add(ChatGroup(id=cgid, idea_id=iid))
            ts.flush()
            # アイデア0＝1メッセージ(今日)／アイデア1＝2メッセージ(今日・昨日)。
            ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cgid, author_id=env.owner_id,
                               body=secret, created_at=now))
            if n == 1:
                ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cgid, author_id=env.owner_id,
                                   body=secret, created_at=now - timedelta(days=1)))
        ts.commit()
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(f"/api/v1/quests/{qid}/catalog-detail")
    assert r.status_code == 200, r.text
    body = r.json()
    act = body["activity"]
    # 横断合算＝総数3・日別に集計（今日2・昨日1）。
    assert act["total"] == 3
    counts = {d["date"]: d["count"] for d in act["daily"]}
    assert counts.get(now.date().isoformat()) == 2
    assert counts.get((now - timedelta(days=1)).date().isoformat()) == 1
    # メタのみ＝チャット本文は応答に一切含まれない。
    assert "SECRET_CHAT_BODY_SHOULD_NOT_LEAK" not in r.text


# --- C-TC-269〜272: 受信側（参加リクエストの一覧/承認/却下・SC-12・C.9.1）---

def _make_owner(env, factory):
    """ACME-01 の実アカウント owner を1人作り (account, user_id) を返す（承認/却下のログイン用）。"""
    acc = factory.make_seed_company_account()
    with get_tenant_session(env.db) as ts:
        ouid = get_user_by_account(ts, acc["id"]).id
    return acc, ouid


def test_c_tc_269_join_requests_list(client, factory, env):
    """C-TC-269 参加リクエスト一覧（owner）＝pending 上位/rejected 下部・申請者メタ・非 owner は 403。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    other = uuid.uuid4()
    env.extra_users.append(other)
    with get_tenant_session(env.db) as ts:
        ts.add(User(id=other, account_id=uuid.uuid4(), display_name="Rejected One", locale="ja", status="active"))
        repo.create_join_request(ts, qid, env.viewer_id, "参加したい")   # pending
        jr2 = repo.create_join_request(ts, qid, other, "let me in")
        jr2.status = "rejected"
        ts.commit()
    # 非 owner（viewer）は 403。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(f"/api/v1/quests/{qid}/join-requests").status_code == 403
    # owner は一覧を取得＝pending 上位・rejected 下部、申請者メタ付き。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    r = client.get(f"/api/v1/quests/{qid}/join-requests")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert [row["status"] for row in data] == ["pending", "rejected"]  # pending 上位
    pend = data[0]
    assert pend["user"]["user_id"] == str(env.viewer_id)
    assert "display_name" in pend["user"] and "group_ids" in pend["user"]
    assert pend["message"] == "参加したい" and "created_at" in pend


def test_c_tc_270_approve_adds_member_and_notifies(client, factory, env):
    """C-TC-270 承認＝pending→approved＋member 追加（既定権限）＋申請者へ通知＋my_state=member。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{qid}/join-request", json={"message": "入りたい"},
                       headers=_csrf(client)).status_code == 201
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    a = client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve", headers=_csrf(client))
    assert a.status_code == 200 and a.json()["status"] == "approved", a.text
    with get_tenant_session(env.db) as ts:
        m = repo.get_active_member(ts, qid, env.viewer_id)
        assert m is not None
        assert set(repo.get_permissions(ts, m.id)) == {"vote", "idea_create", "comment"}  # 既定権限
        jr = repo.get_join_request(ts, qid, env.viewer_id)
        assert jr.status == "approved" and jr.decided_at is not None and jr.decided_by_id == ouid
        n = ts.execute(select(Notification).where(
            Notification.recipient_id == env.viewer_id, Notification.ref_quest_id == qid,
            Notification.type == "join_request_decided")).scalars().all()
        assert len(n) == 1 and n[0].params.get("result") == "approved"
    # 申請者側カタログ＝my_state=member。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    card = next(c for c in client.get(CATALOG).json()["data"] if c["id"] == str(qid))
    assert card["my_state"] == "member"


def test_c_tc_271_reject_is_non_terminal(client, factory, env):
    """C-TC-271 却下＝行を残し（my_state=rejected）＋通知／後日 approve で復活（rejected→approved＋member）。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client))
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    rj = client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/reject", headers=_csrf(client))
    assert rj.status_code == 200 and rj.json()["status"] == "rejected", rj.text
    with get_tenant_session(env.db) as ts:
        jr = repo.get_join_request(ts, qid, env.viewer_id)
        assert jr.status == "rejected" and jr.decided_at is not None      # 行は残る（非終端）
        assert repo.get_active_member(ts, qid, env.viewer_id) is None     # member にはしない
        n = ts.execute(select(Notification).where(
            Notification.recipient_id == env.viewer_id, Notification.ref_quest_id == qid,
            Notification.type == "join_request_decided")).scalars().all()
        assert len(n) == 1 and n[0].params.get("result") == "rejected"
    # 申請者側カタログ＝my_state=rejected。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    card = next(c for c in client.get(CATALOG).json()["data"] if c["id"] == str(qid))
    assert card["my_state"] == "rejected"
    # owner: 却下者は status=rejected 一覧に出る＋後日 approve で復活。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    lst = client.get(f"/api/v1/quests/{qid}/join-requests", params={"status": "rejected"})
    assert lst.status_code == 200 and any(
        row["user"]["user_id"] == str(env.viewer_id) for row in lst.json()["data"])
    ap = client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve", headers=_csrf(client))
    assert ap.status_code == 200 and ap.json()["status"] == "approved"
    with get_tenant_session(env.db) as ts:
        assert repo.get_active_member(ts, qid, env.viewer_id) is not None  # 復活で member 化


def test_c_tc_272_receiver_authz_and_state_guards(client, factory, env):
    """C-TC-272 認可/状態ガード＝非 owner は 403／未申請 approve は 404／approved を reject は 409 invalid_state。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    # viewer（非 owner/admin）の一覧/承認/却下は 403。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.get(f"/api/v1/quests/{qid}/join-requests").status_code == 403
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{ouid}/approve",
                       headers=_csrf(client)).status_code == 403
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{ouid}/reject",
                       headers=_csrf(client)).status_code == 403
    # owner: 未申請 user への approve は 404（存在秘匿）。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve",
                       headers=_csrf(client)).status_code == 404
    # approved 済みを reject は 409 invalid_state。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client))
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve", headers=_csrf(client))
    rj = client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/reject", headers=_csrf(client))
    assert rj.status_code == 409, rj.text
    assert rj.json()["errors"][0]["reason"] == "invalid_state"


def test_c_tc_273_rejoin_after_removal_and_via_request(client, factory, env):
    """C-TC-273 承認→除外→再申請の整合＝再申請 201（回帰）＋「リクエスト経由」via_request 表示。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    # viewer 申請→owner 承認。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client))
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve",
                       headers=_csrf(client)).status_code == 200
    # メンバー一覧＝viewer は via_request=true、owner（手動 owner）は false。
    by = {m["user"]["user_id"]: m for m in client.get(f"/api/v1/quests/{qid}/members").json()["data"]}
    assert by[str(env.viewer_id)]["via_request"] is True
    assert by[str(ouid)]["via_request"] is False
    # パーティーから除外（jr は approved のまま残る＝remove_member は jr に触れない）。
    with get_tenant_session(env.db) as ts:
        repo.remove_member(ts, qid, env.viewer_id)
        ts.commit()
    # 除外後の再申請＝201 pending（旧＝approved jr で 409 already_member を弾いていた回帰）。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.post(f"/api/v1/quests/{qid}/join-request", json={"message": "また入りたい"}, headers=_csrf(client))
    assert r.status_code == 201 and r.json()["status"] == "pending", r.text
    # 再承認で member 復活＋via_request=true。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve",
                       headers=_csrf(client)).status_code == 200
    with get_tenant_session(env.db) as ts:
        assert repo.get_active_member(ts, qid, env.viewer_id) is not None
    by2 = {m["user"]["user_id"]: m for m in client.get(f"/api/v1/quests/{qid}/members").json()["data"]}
    assert by2[str(env.viewer_id)]["via_request"] is True


def test_c_tc_275_join_request_profile(client, factory, env):
    """C-TC-275 申請者プロフィール（承認判断材料）＝owner のみ／申請なし user は 404／中核指標＋ゲーム層ゲート。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client))  # viewer pending
    # 非 owner（viewer 本人）は 403。
    assert client.get(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/profile").status_code == 403
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    # 申請のない user のプロフィールは覗けない（存在秘匿 404）。
    assert client.get(f"/api/v1/quests/{qid}/join-requests/{uuid.uuid4()}/profile").status_code == 404
    # 申請者プロフィール＝中核指標（int）＋game は null か {avatar_base,...}（viewer=owner のゲームモード次第）。
    r = client.get(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/profile")
    assert r.status_code == 200, r.text
    p = r.json()
    assert isinstance(p["active_quest_count"], int) and p["active_quest_count"] >= 0
    assert isinstance(p["published_idea_count"], int)
    assert isinstance(p["chat_message_count"], int)
    assert "game" in p and "評価" not in r.text  # 受けた評価平均は出さない（出しすぎ回避）
    if p["game"] is not None:
        assert p["game"]["avatar_base"] in ("male", "female")
        assert isinstance(p["game"]["achievement_count"], int) and "rank" in p["game"]


def test_c_tc_279_quest_activity_member(client, env):
    """C-TC-279 クエスト内活発度（SC-12）＝メンバーは daily/total 取得／非メンバーは 404（存在秘匿）。"""
    qid = env.new_quest(discoverable=False)  # viewer は既定で非メンバー
    now = datetime.now(timezone.utc)
    with get_tenant_session(env.db) as ts:
        repo.add_member(ts, qid, env.viewer_id, permissions=["comment"])  # viewer をメンバーに
        iid = uuid.uuid4()
        ts.add(Idea(id=iid, quest_id=qid, author_id=env.owner_id, title="I", body="b", value="v", status="published"))
        ts.flush()
        cgid = uuid.uuid4()
        ts.add(ChatGroup(id=cgid, idea_id=iid))
        ts.flush()
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cgid, author_id=env.owner_id, body="m1", created_at=now))
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cgid, author_id=env.owner_id, body="m2", created_at=now - timedelta(days=1)))
        ts.commit()
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    r = client.get(f"/api/v1/quests/{qid}/activity")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2 and body["days"] == 14
    counts = {d["date"]: d["count"] for d in body["daily"]}
    assert counts.get(now.date().isoformat()) == 1
    assert counts.get((now - timedelta(days=1)).date().isoformat()) == 1
    # 非メンバー（viewer が入っていない別クエスト）は 404。
    other = env.new_quest(discoverable=False)
    assert client.get(f"/api/v1/quests/{other}/activity").status_code == 404


def test_c_tc_276_create_discoverable(client, factory, env):
    """C-TC-276 作成時に discoverable を指定＝応答/GET detail に反映／未指定は既定 false。"""
    owner_acc, _ouid = _make_owner(env, factory)
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    # discoverable=true（recruiting・全社）で作成。
    r = client.post("/api/v1/quests", json={
        "title": "発見可能クエスト", "color": "#3B82F6", "categories": ["改善"],
        "status": "recruiting", "discoverable": True,
    }, headers=_csrf(client))
    assert r.status_code == 201, r.text
    qid = r.json()["id"]; env.quests.append(uuid.UUID(qid))
    assert r.json()["discoverable"] is True
    assert client.get(f"/api/v1/quests/{qid}").json()["discoverable"] is True  # GET detail にも反映
    # discoverable 未指定＝既定 false（サーバー設定・§1.4）。
    r2 = client.post("/api/v1/quests", json={
        "title": "非公開クエスト", "color": "#3B82F6", "categories": ["改善"], "status": "recruiting",
    }, headers=_csrf(client))
    assert r2.status_code == 201 and r2.json()["discoverable"] is False, r2.text
    env.quests.append(uuid.UUID(r2.json()["id"]))


def test_c_tc_277_update_discoverable_toggles_catalog(client, factory, env):
    """C-TC-277 編集の discoverable トグル＝発見カタログ出没が連動＋detail 反映（owner/quest_admin）。"""
    owner_acc, _ouid = _make_owner(env, factory)
    # recruiting・全社（部署0件）・discoverable=false を API 作成。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    r = client.post("/api/v1/quests", json={
        "title": "トグル検証クエスト", "color": "#3B82F6", "categories": ["改善"],
        "status": "recruiting", "discoverable": False,
    }, headers=_csrf(client))
    assert r.status_code == 201, r.text
    qid = r.json()["id"]; env.quests.append(uuid.UUID(qid))
    # viewer（seed・非メンバー）＝false のうちは catalog に出ない。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert qid not in _catalog_ids(client)
    # owner が discoverable=true に。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    up = client.patch(f"/api/v1/quests/{qid}", json={"discoverable": True}, headers=_csrf(client))
    assert up.status_code == 200 and up.json()["discoverable"] is True, up.text
    # viewer catalog に出る（my_state=none）。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    card = next((c for c in client.get(CATALOG).json()["data"] if c["id"] == qid), None)
    assert card is not None and card["my_state"] == "none"
    # owner が false に戻す→ catalog から消える＋detail 反映。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    down = client.patch(f"/api/v1/quests/{qid}", json={"discoverable": False}, headers=_csrf(client))
    assert down.status_code == 200 and down.json()["discoverable"] is False
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert qid not in _catalog_ids(client)


def _watch_events(env, qid):
    """viewer に届いた quest_watch_update の event 一覧（テスト補助）。"""
    with get_tenant_session(env.db) as ts:
        ns = ts.execute(select(Notification).where(
            Notification.recipient_id == env.viewer_id, Notification.ref_quest_id == uuid.UUID(qid),
            Notification.type == "quest_watch_update")).scalars().all()
        return [n.params.get("event") for n in ns]


def _create_discoverable_via_api(client, owner_acc, env, title):
    """owner が recruiting・全社・discoverable のクエストを API 作成し id を返す（env.quests に登録）。"""
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    r = client.post("/api/v1/quests", json={
        "title": title, "color": "#3B82F6", "categories": ["改善"], "status": "recruiting", "discoverable": True,
    }, headers=_csrf(client))
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    env.quests.append(uuid.UUID(qid))
    return qid


def test_c_tc_280_watch_status_deadline_and_expiry(client, factory, env):
    """C-TC-280 quest_watch_update＝フォロワーへ status_changed/deadline／非discoverable 化で動的失効。"""
    owner_acc, _ouid = _make_owner(env, factory)
    qid = _create_discoverable_via_api(client, owner_acc, env, "Watch対象1")
    # viewer がフォロー。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{qid}/follow", headers=_csrf(client)).status_code == 200
    # owner が状態遷移＋締切変更。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    assert client.post(f"/api/v1/quests/{qid}/transition", json={"to": "in_progress"}, headers=_csrf(client)).status_code == 200
    assert client.patch(f"/api/v1/quests/{qid}", json={"deadline": "2027-01-31"}, headers=_csrf(client)).status_code == 200
    ev = _watch_events(env, qid)
    assert "status_changed" in ev and "deadline" in ev, ev
    n_before = len(ev)
    # 非discoverable 化 → 以降の遷移はフォロワーに通知しない（発見可能な間のみ・動的失効）。
    assert client.patch(f"/api/v1/quests/{qid}", json={"discoverable": False}, headers=_csrf(client)).status_code == 200
    assert client.post(f"/api/v1/quests/{qid}/transition", json={"to": "evaluating"}, headers=_csrf(client)).status_code == 200
    assert len(_watch_events(env, qid)) == n_before  # 失効後は増えない


def test_c_tc_281_watch_new_ideas_and_completed(client, factory, env):
    """C-TC-281 quest_watch_update＝フォロワーへ new_ideas（公開者除外）と completed。"""
    owner_acc, _ouid = _make_owner(env, factory)
    qid = _create_discoverable_via_api(client, owner_acc, env, "Watch対象2")
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{qid}/follow", headers=_csrf(client)).status_code == 200
    # owner が公開アイデアを投稿 → new_ideas。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    ir = client.post(f"/api/v1/quests/{qid}/ideas", json={
        "title": "I1", "body": "本文テキスト", "value": "提供価値", "status": "published",
    }, headers=_csrf(client))
    assert ir.status_code == 201, ir.text
    # completed まで前進（recruiting→in_progress→evaluating→completed）。
    for to in ("in_progress", "evaluating", "completed"):
        assert client.post(f"/api/v1/quests/{qid}/transition", json={"to": to}, headers=_csrf(client)).status_code == 200, to
    ev = _watch_events(env, qid)
    assert "new_ideas" in ev and "completed" in ev, ev


def test_i_tc_159_dashboard_follows_and_join_requests(client, env):
    """I-TC-159 SC-01 §4.6b/§4.6c＝dashboard に followed_quests（following）と join_requests（pending/rejected）。"""
    followed_q = env.new_quest(discoverable=True)
    pending_q = env.new_quest(discoverable=True)
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{followed_q}/follow", headers=_csrf(client)).status_code == 200
    assert client.post(f"/api/v1/quests/{pending_q}/join-request", json={}, headers=_csrf(client)).status_code == 201
    d = client.get("/api/v1/dashboard").json()
    fq = {c["id"]: c for c in d["followed_quests"]}
    jr = {c["id"]: c for c in d["join_requests"]}
    # フォロー中は followed_quests のみ（following）。
    assert str(followed_q) in fq and str(followed_q) not in jr
    assert fq[str(followed_q)]["my_state"] == "following"
    # 参加リクエスト（pending）は join_requests のみ。
    assert str(pending_q) in jr and str(pending_q) not in fq
    assert jr[str(pending_q)]["my_state"] == "pending"


def test_i_tc_160_dashboard_incoming_join_requests(client, factory, env):
    """I-TC-160 SC-01・FR-40＝owner/quest_admin の dashboard に未処理(pending)受信リクエスト（クエスト概要＋申請者）。承認で消える。"""
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    # viewer が申請（pending）。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{qid}/join-request", json={"message": "入れて"}, headers=_csrf(client)).status_code == 201
    # owner のダッシュボードに未処理リクエストが1件＝クエスト概要＋申請者メタ＋メッセージ。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    inc = [x for x in client.get("/api/v1/dashboard").json()["incoming_join_requests"] if x["quest"]["id"] == str(qid)]
    assert len(inc) == 1
    item = inc[0]
    assert item["quest"]["title"] == "Cat" and item["quest"]["status"] == "recruiting"  # 概要（どのクエストか）
    assert item["user"]["user_id"] == str(env.viewer_id) and "display_name" in item["user"]
    assert item["message"] == "入れて"
    # 非 owner（viewer）のダッシュボードには出ない（受信側は owner/quest_admin のみ）。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert all(x["quest"]["id"] != str(qid) for x in client.get("/api/v1/dashboard").json()["incoming_join_requests"])
    # owner が承認したら未処理から消える。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve", headers=_csrf(client)).status_code == 200
    assert all(x["quest"]["id"] != str(qid) for x in client.get("/api/v1/dashboard").json()["incoming_join_requests"])


def test_i_tc_161_recent_chats(client, env):
    """I-TC-161 🕒 最近の議論＝更新順・既読/未読問わず・自分投稿含む（新着=未読のみ とは別動線・SC-01 §4.8c）。"""
    qid = env.new_quest(discoverable=True)
    now = datetime.now(timezone.utc)
    ia, ib = uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(env.db) as ts:
        repo.add_member(ts, qid, env.viewer_id, permissions=["comment"])  # viewer を member に
        # A＝自分(viewer)の投稿だけ・最新（新着には出ない／最近には出る）。
        ts.add(Idea(id=ia, quest_id=qid, author_id=env.viewer_id, title="自分議論", body="b", value="v", status="published"))
        # B＝他ユーザー(owner)の未読投稿・やや古い（新着にも最近にも出る）。
        ts.add(Idea(id=ib, quest_id=qid, author_id=env.owner_id, title="他人議論", body="b", value="v", status="published"))
        ts.flush()
        cga, cgb = uuid.uuid4(), uuid.uuid4()
        ts.add(ChatGroup(id=cga, idea_id=ia)); ts.add(ChatGroup(id=cgb, idea_id=ib)); ts.flush()
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cga, author_id=env.viewer_id, body="mine", created_at=now))
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cgb, author_id=env.owner_id, body="theirs", created_at=now - timedelta(hours=1)))
        ts.commit()
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    d = client.get("/api/v1/dashboard").json()
    recent = [c["id"] for c in d["recent_chats"]]
    unread = [c["id"] for c in d["unread_chats"]]
    # 最近＝更新順（A=now が先・B=now-1h が後）・**自分投稿(A)も含む**。
    assert recent[:2] == [str(ia), str(ib)]
    # 新着＝未読(他ユーザー)のみ＝B だけ・自分投稿だけの A は出ない（別動線）。
    assert str(ib) in unread and str(ia) not in unread


def test_c_tc_282_join_request_emails(client, factory, env):
    """C-TC-282 参加リクエスト受信/結果で業務通知メールを mail_outbox に enqueue（会社トグル ON・既定）。"""
    from app.control_plane.auth.orm import Account
    from app.control_plane.mail_outbox.orm import MailOutboxEntry
    owner_acc, ouid = _make_owner(env, factory)  # 実アカウント（Account+email あり）
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    # viewer が申請 → owner（作成者）にメール。
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    assert client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client)).status_code == 201
    with control_session() as cs:
        recv = cs.execute(select(MailOutboxEntry).where(
            MailOutboxEntry.category == "join_request_received",
            MailOutboxEntry.account_id == owner_acc["id"])).scalars().all()
        assert len(recv) == 1 and recv[0].to_email == owner_acc["email"]
        assert recv[0].params.get("quest_title") == "Cat"  # env.new_quest の title
    # owner が承認 → 申請者（viewer）にメール。
    _login(client, SEED_COMPANY_CODE, owner_acc["login_id"], owner_acc["password"])
    assert client.post(f"/api/v1/quests/{qid}/join-requests/{env.viewer_id}/approve", headers=_csrf(client)).status_code == 200
    with control_session() as cs:
        viewer_acc = cs.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
        dec = cs.execute(select(MailOutboxEntry).where(
            MailOutboxEntry.category == "join_request_decided",
            MailOutboxEntry.account_id == viewer_acc.id)).scalars().all()
        assert any(e.params.get("result") == "approved" for e in dec)


def test_c_tc_283_join_request_email_company_toggle_off(client, factory, env):
    """C-TC-283 会社トグル OFF なら業務通知メールを積まない（notify_email_enabled=false）。"""
    from app.control_plane.auth.orm import Company as _Company
    from app.control_plane.mail_outbox.orm import MailOutboxEntry
    owner_acc, ouid = _make_owner(env, factory)
    qid = env.new_quest(discoverable=True, owner=ouid, group=env.g_in)
    with control_session() as cs:
        co = cs.query(_Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        co.notify_email_enabled = False
        cs.commit()
    try:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        assert client.post(f"/api/v1/quests/{qid}/join-request", json={}, headers=_csrf(client)).status_code == 201
        with control_session() as cs:
            n = cs.execute(select(MailOutboxEntry).where(
                MailOutboxEntry.category == "join_request_received",
                MailOutboxEntry.account_id == owner_acc["id"])).scalars().all()
            assert len(n) == 0  # 会社 OFF＝業務通知メールは積まれない
    finally:
        with control_session() as cs:  # seed 会社の設定を元に戻す（他テストへ波及させない）
            co = cs.query(_Company).filter_by(company_code=SEED_COMPANY_CODE).one()
            co.notify_email_enabled = True
            cs.commit()
