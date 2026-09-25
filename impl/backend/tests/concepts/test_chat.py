"""P-TC-501〜506: コンセプト議論チャット（P.6・E 機構を chat_messages/chat_reads で共有）。

スコープ一覧（総合/グループ/前提スレッド＋未読）・グループ作成（owner）・メッセージ取得/投稿（Idempotency-Key）・既読。
門番＝パーティー所属。teardown で作成データを物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat.orm import ChatMessage, ChatRead
from app.tenant.concepts import repository as repo
from app.tenant.concepts.orm import (
    Assumption,
    Concept,
    ConceptAssumptionLink,
    ConceptChatScope,
)
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id
    group_id, other_id = uuid.uuid4(), uuid.uuid4()
    quests: list[uuid.UUID] = []
    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, owner=None, seed_perms=None, seed_member=True) -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, owner_id=the_owner, title="Q", color="#3B82F6", status="evaluating")
            quests_repo.add_member(ts, qid, the_owner, permissions=["owner"])
            if seed_member and the_owner != user_id:
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["vote"])
            ts.commit()
        quests.append(qid)
        return qid

    def seed_active_concept(qid, *, author=None) -> uuid.UUID:
        with get_tenant_session(db_identifier) as ts:
            c = repo.create_concept(ts, quest_id=qid, author_id=author or user_id, title="C")
            c.status = "active"
            cid = c.id
            repo.create_chat_scope(ts, concept_id=cid, kind="overall", position=0)
            ts.commit()
        return cid

    yield SimpleNamespace(db_identifier=db_identifier, user_id=user_id, other_id=other_id,
                          make_quest=make_quest, seed_active_concept=seed_active_concept, quests=quests)

    with get_tenant_session(db_identifier) as ts:
        cids = [c.id for c in ts.query(Concept).filter(Concept.quest_id.in_(quests or [uuid.uuid4()])).all()]
        aids = [a.id for a in ts.query(Assumption).filter(Assumption.quest_id.in_(quests or [uuid.uuid4()])).all()]
        sids = [s.id for s in ts.query(ConceptChatScope).filter(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])).all()]
        ts.execute(ChatRead.__table__.delete().where(ChatRead.concept_chat_scope_id.in_(sids or [uuid.uuid4()])))
        ts.execute(ChatMessage.__table__.delete().where(ChatMessage.concept_chat_scope_id.in_(sids or [uuid.uuid4()])))
        ts.execute(ConceptChatScope.__table__.delete().where(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptAssumptionLink.__table__.delete().where(ConceptAssumptionLink.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(Assumption.__table__.delete().where(Assumption.quest_id.in_(quests or [uuid.uuid4()])))
        ts.execute(Concept.__table__.delete().where(Concept.quest_id.in_(quests or [uuid.uuid4()])))
        for qid in quests:
            ts.execute(QuestMemberPermission.__table__.delete().where(
                QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.commit()


def _login_seed(client):
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


def _overall_scope(client, cid) -> str:
    scopes = client.get(f"/api/v1/concepts/{cid}/chat-scopes").json()["items"]
    return next(s["scope_id"] for s in scopes if s["kind"] == "overall")


def test_p_tc_501_list_scopes(env, client):
    """P-TC-501: スコープ一覧＝総合/グループ/前提スレッド＋未読。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = env.seed_active_concept(qid)
    client.post(f"/api/v1/concepts/{cid}/chat-scopes", json={"label": "価値"}, headers=_csrf(client))
    aid = client.post(f"/api/v1/quests/{qid}/assumptions", json={"statement": "s"}, headers=_csrf(client)).json()["id"]
    client.post(f"/api/v1/concepts/{cid}/assumptions", json={"assumption_id": aid}, headers=_csrf(client))
    items = client.get(f"/api/v1/concepts/{cid}/chat-scopes").json()["items"]
    kinds = {s["kind"] for s in items}
    assert {"overall", "group", "assumption"} <= kinds
    assert all("unread_count" in s for s in items)


def test_p_tc_502_create_group_permission(env, client):
    """P-TC-502: グループ・ルーム作成は owner=201／非 manager=403。"""
    _login_seed(client)
    cid = env.seed_active_concept(env.make_quest())
    r = client.post(f"/api/v1/concepts/{cid}/chat-scopes", json={"label": "採算"}, headers=_csrf(client))
    assert r.status_code == 201 and r.json()["kind"] == "group"
    q_other = env.make_quest(owner=env.other_id, seed_perms=["vote"])
    cid2 = env.seed_active_concept(q_other, author=env.other_id)
    r2 = client.post(f"/api/v1/concepts/{cid2}/chat-scopes", json={"label": "x"}, headers=_csrf(client))
    assert r2.status_code == 403


def test_p_tc_503_post_message_idempotent(env, client):
    """P-TC-503: 投稿＝concept_chat_scope_id に紐付き・Idempotency-Key 再送で二重投稿しない。"""
    _login_seed(client)
    cid = env.seed_active_concept(env.make_quest())
    sid = _overall_scope(client, cid)
    key = str(uuid.uuid4())
    h = {**_csrf(client), "Idempotency-Key": key}
    r1 = client.post(f"/api/v1/concept-chat-scopes/{sid}/messages", json={"body": "hello"}, headers=h)
    assert r1.status_code == 201
    r2 = client.post(f"/api/v1/concept-chat-scopes/{sid}/messages", json={"body": "hello"}, headers=h)
    assert r2.json()["id"] == r1.json()["id"]  # 冪等
    msgs = client.get(f"/api/v1/concept-chat-scopes/{sid}/messages").json()["items"]
    assert len(msgs) == 1 and msgs[0]["body"] == "hello"


def test_p_tc_504_list_messages(env, client):
    """P-TC-504: メッセージ取得（作成順）。"""
    _login_seed(client)
    cid = env.seed_active_concept(env.make_quest())
    sid = _overall_scope(client, cid)
    for b in ("m1", "m2"):
        client.post(f"/api/v1/concept-chat-scopes/{sid}/messages", json={"body": b}, headers=_csrf(client))
    msgs = client.get(f"/api/v1/concept-chat-scopes/{sid}/messages").json()["items"]
    assert [m["body"] for m in msgs] == ["m1", "m2"]


def test_p_tc_505_read_updates_unread(env, client):
    """P-TC-505: 既読位置更新で未読数が減る。"""
    _login_seed(client)
    cid = env.seed_active_concept(env.make_quest())
    sid = _overall_scope(client, cid)
    m1 = client.post(f"/api/v1/concept-chat-scopes/{sid}/messages", json={"body": "a"}, headers=_csrf(client)).json()["id"]
    client.post(f"/api/v1/concept-chat-scopes/{sid}/messages", json={"body": "b"}, headers=_csrf(client))
    r = client.post(f"/api/v1/concept-chat-scopes/{sid}/read", json={"last_read_message_id": m1}, headers=_csrf(client))
    assert r.status_code == 204
    scope = next(s for s in client.get(f"/api/v1/concepts/{cid}/chat-scopes").json()["items"] if s["scope_id"] == sid)
    assert scope["unread_count"] == 1  # m1 既読・残り b の1件


def test_p_tc_506_gatekeeper_non_party(env, client):
    """P-TC-506: 非パーティーはスコープ一覧/投稿不可（404 秘匿）。"""
    _login_seed(client)
    q = env.make_quest(owner=env.other_id, seed_member=False)  # seed は非メンバー
    cid = env.seed_active_concept(q, author=env.other_id)
    assert client.get(f"/api/v1/concepts/{cid}/chat-scopes").status_code == 404
