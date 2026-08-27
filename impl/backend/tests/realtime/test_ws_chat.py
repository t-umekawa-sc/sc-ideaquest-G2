"""L-TC-111〜121: chat トピックの購読門番・配信・購読中失効（E→L・C→L.4）。

seed 会社 ACME-01 に quest＋公開 idea＋パーティーを seed。WS は context-managed TestClient（lifespan で
ハブ起動）。publish は REST 経由（E の post-commit）→ WS 受信を照合。門番は REST と同一（gate.py）。
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.main import app
from app.tenant.chat import repository as chat_repo
from app.tenant.chat.orm import ChatGroup, ChatMessage, Reaction
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

REALTIME = "/api/v1/realtime"
MSGS = "/api/v1/chat-messages"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def chatenv(factory):
    with control_session() as s:
        db = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        seed_acc = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db) as ts:
        seed_uid = get_user_by_account(ts, seed_acc.id).id

    gid, qid, iid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        quests_repo.create_quest(ts, quest_id=qid, quest_group_id=gid, owner_id=seed_uid,
                                 title="Q", color="#3B82F6", status="recruiting")
        quests_repo.add_member(ts, qid, seed_uid, permissions=["owner", "comment", "vote"])
        ts.add(Idea(id=iid, quest_id=qid, author_id=seed_uid, title="I", body="b", value="v", status="published"))
        ts.commit()

    yield {"db": db, "seed_uid": seed_uid, "quest_id": qid, "idea_id": iid}

    with get_tenant_session(db) as ts:
        cg = chat_repo.get_chat_group_by_idea(ts, iid)
        if cg is not None:
            mids = [m.id for m in ts.execute(select(ChatMessage).where(ChatMessage.chat_group_id == cg.id)).scalars()]
            if mids:
                ts.execute(Reaction.__table__.delete().where(Reaction.chat_message_id.in_(mids)))
            ts.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_group_id == cg.id))
            ts.execute(ChatGroup.__table__.delete().where(ChatGroup.id == cg.id))
        ts.execute(Idea.__table__.delete().where(Idea.id == iid))
        ts.execute(QuestMemberPermission.__table__.delete().where(
            QuestMemberPermission.quest_member_id.in_(
                select(QuestMember.id).where(QuestMember.quest_id == qid))))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
        ts.commit()


def _cg_id(chatenv) -> str:
    """GET chat で chat_group を遅延生成し id を得る。"""
    with TestClient(app) as c:
        _login(c, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        return c.get(f"/api/v1/ideas/{chatenv['idea_id']}/chat").json()["chat_group_id"]


def test_l_tc_111_subscribe_gate_ok_and_message_delivery(chatenv):
    """L-TC-111 パーティー員は購読受理→新着メッセージを受信。"""
    cg = _cg_id(chatenv)
    with TestClient(app) as client:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        with client.websocket_connect(REALTIME) as ws:
            ws.send_json({"op": "subscribe", "topic": f"chat:{cg}"})
            assert ws.receive_json() == {"op": "subscribed", "topic": f"chat:{cg}"}
            r = client.post(MSGS, data={"idea_id": str(chatenv["idea_id"]), "body": "やあ"},
                            headers=_csrf(client))
            assert r.status_code == 201, r.text
            evt = ws.receive_json()
            assert evt["topic"] == f"chat:{cg}" and evt["type"] == "chat.message.created"
            assert evt["data"]["body"] == "やあ"


def test_l_tc_112_subscribe_gate_denied_for_non_member(chatenv, factory):
    """L-TC-112 非パーティー員は購読拒否（存在秘匿）。"""
    cg = _cg_id(chatenv)
    outsider = factory.make_seed_company_account()  # パーティー未参加の実アカウント
    with TestClient(app) as client:
        _login(client, SEED_COMPANY_CODE, outsider["login_id"], outsider["password"])
        with client.websocket_connect(REALTIME) as ws:
            ws.send_json({"op": "subscribe", "topic": f"chat:{cg}"})
            resp = ws.receive_json()
            assert resp["op"] == "error" and resp["code"] == "subscribe_denied"


def test_l_tc_113_reaction_and_delete_delivery(chatenv):
    """L-TC-113 リアクション付与→removed・削除（トゥームストーン）の配信。"""
    cg = _cg_id(chatenv)
    with TestClient(app) as client:
        _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
        mid = client.post(MSGS, data={"idea_id": str(chatenv["idea_id"]), "body": "m"},
                          headers=_csrf(client)).json()["id"]
        with client.websocket_connect(REALTIME) as ws:
            ws.send_json({"op": "subscribe", "topic": f"chat:{cg}"})
            assert ws.receive_json()["op"] == "subscribed"
            # リアクション付与
            r = client.post(f"{MSGS}/{mid}/reactions", json={"type": "normal", "emoji": "👍"},
                            headers=_csrf(client))
            assert r.status_code == 200, r.text
            evt = ws.receive_json()
            assert evt["type"] == "chat.reaction.added" and evt["data"]["message_id"] == mid
            # 削除（トゥームストーン）
            client.delete(f"{MSGS}/{mid}", headers=_csrf(client))
            evt2 = ws.receive_json()
            assert evt2["type"] == "chat.message.deleted" and evt2["data"]["is_deleted"] is True


def test_l_tc_121_revoke_on_member_removal(chatenv, factory):
    """L-TC-121 パーティー除去で購読が失効＝除去後は新着が届かず再購読も拒否。"""
    cg = _cg_id(chatenv)
    member = factory.make_seed_company_account()
    with get_tenant_session(chatenv["db"]) as ts:
        muid = get_user_by_account(ts, member["id"]).id
        quests_repo.add_member(ts, chatenv["quest_id"], muid, permissions=["comment"])
        ts.commit()

    # owner は REST/publish 専用＝lifespan 不要の素の TestClient（ハブは mclient 側の1ループに集約）
    owner = TestClient(app)
    _login(owner, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    with TestClient(app) as mclient:
        _login(mclient, SEED_COMPANY_CODE, member["login_id"], member["password"])
        with mclient.websocket_connect(REALTIME) as ws:
            ws.send_json({"op": "subscribe", "topic": f"chat:{cg}"})
            assert ws.receive_json()["op"] == "subscribed"
            # 除去前＝新着が届く（購読が有効）
            owner.post(MSGS, data={"idea_id": str(chatenv["idea_id"]), "body": "before"},
                       headers=_csrf(owner))
            assert ws.receive_json()["data"]["body"] == "before"
            # owner がメンバーを除去（C.3）→ 失効シグナル
            r = owner.delete(f"/api/v1/quests/{chatenv['quest_id']}/members/{muid}",
                             headers=_csrf(owner))
            assert r.status_code == 204, r.text
            # 除去後＝新着 publish → 届かない。直後の再購読は門番で拒否（＝次に届くのは error のみ）
            owner.post(MSGS, data={"idea_id": str(chatenv["idea_id"]), "body": "after"},
                       headers=_csrf(owner))
            ws.send_json({"op": "subscribe", "topic": f"chat:{cg}"})
            resp = ws.receive_json()
            assert resp["op"] == "error" and resp["code"] == "subscribe_denied"  # "after" は届いていない


def test_l_tc_122_revoke_on_bulk_party_removal(chatenv, factory, monkeypatch):
    """L-TC-122 バルクのパーティー更新（PUT /party）での除去でも失効シグナルが発火（L.4・M1）。

    増分 DELETE /members（L-TC-121）だけでなく、SC-11 の全体編集経路（set_party/update_quest/publish）
    でも除去メンバー×chat group に publish_revoke を出す（結線漏れの根治）。
    """
    cg = _cg_id(chatenv)
    member = factory.make_seed_company_account()
    with get_tenant_session(chatenv["db"]) as ts:
        muid = get_user_by_account(ts, member["id"]).id
        quests_repo.add_member(ts, chatenv["quest_id"], muid, permissions=["comment"])
        ts.commit()

    calls: list = []
    monkeypatch.setattr("app.tenant.realtime.events.publish_revoke",
                        lambda uid, cg_id, *, company_id: calls.append((str(uid), str(cg_id))))

    owner = TestClient(app)
    _login(owner, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)
    # PUT /party で member を除外（owner のみ残す＝bulk 除去）
    r = owner.put(f"/api/v1/quests/{chatenv['quest_id']}/party", json={"members": []}, headers=_csrf(owner))
    assert r.status_code == 200, r.text
    # 除去メンバー×chat group に失効シグナルが発火（bulk 経路でも L.4）
    assert (str(muid), str(cg)) in calls


def test_l_tc_123_group_removal_revoke_targets(chatenv):
    """L-TC-123 グループ除去の失効対象クエリ＝グループ内クエストで有効パーティー員の chat group を返す（L.4・M1b）。

    クエストグループ除去（control_plane の remove_member）は本クエリで対象 chat group を特定し
    post-commit で publish_revoke する（結線は set_party 等と同一パターン＝L-TC-122）。
    """
    cg = _cg_id(chatenv)
    with get_tenant_session(chatenv["db"]) as ts:
        gid = quests_repo.get_quest(ts, chatenv["quest_id"]).quest_group_id
        # seed_uid は当該グループ内クエストの有効パーティー員＝失効対象に cg が含まれる
        ids = chat_repo.list_chat_group_ids_for_group_member(ts, gid, chatenv["seed_uid"])
        assert cg in {str(x) for x in ids}
        # グループ内クエストに参加していないユーザーは対象ゼロ（過剰失効を出さない）
        assert chat_repo.list_chat_group_ids_for_group_member(ts, gid, uuid.uuid4()) == []
