"""E-TC-101〜114: チャット コア会話 API（SC-24・E.1/E.2/E.5）。

seed 一般ユーザー ACME-01 でログインし、会社DB にクエスト＋パーティー参加＋権限＋公開アイデアを seed。
門番/権限/状態機械/メンション/引用/既読/添付/XP を検証。teardown で作成データ＋活動を物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat import repository as chat_repo
from app.tenant.chat.orm import ChatGroup, ChatMention, ChatMessage, ChatRead, Reaction
from app.tenant.gamification.orm import Activity
from app.tenant.ideas import repository as ideas_repo
from app.tenant.ideas.orm import Attachment, Idea, IdeaRevision
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
MSGS = "/api/v1/chat-messages"
CHAT = lambda i: f"/api/v1/ideas/{i}/chat"  # noqa: E731


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


def _post(client, idea_id, *, body=None, mentions=None, reply_to=None, files=None):
    data = {"idea_id": str(idea_id)}
    if body is not None:
        data["body"] = body
    if reply_to is not None:
        data["reply_to_message_id"] = str(reply_to)
    if mentions is not None:
        data["mentions"] = [str(m) for m in mentions]
    return client.post(MSGS, data=data, files=files, headers=_csrf(client))


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id

    group_id, other_id = uuid.uuid4(), uuid.uuid4()
    quests: list[uuid.UUID] = []
    ideas: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, owner=None, status="recruiting", seed_perms=None, seed_member=True) -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, quest_group_id=group_id, owner_id=the_owner, title="Q", color="#3B82F6", status=status)
            quests_repo.add_member(ts, qid, the_owner, permissions=["owner"])
            if seed_member and the_owner != user_id:
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["comment", "vote"])
            ts.commit()
        quests.append(qid)
        return qid

    def make_idea(*, quest_id, author=None, status="published") -> uuid.UUID:
        iid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(Idea(id=iid, quest_id=quest_id, author_id=author or user_id, title="I", body="b", value="v", status=status))
            ts.commit()
        ideas.append(iid)
        return iid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, other_id=other_id,
        make_quest=make_quest, make_idea=make_idea,
    )

    with get_tenant_session(db_identifier) as ts:
        cg_ids = [cg.id for i in ideas for cg in ([chat_repo.get_chat_group_by_idea(ts, i)] if chat_repo.get_chat_group_by_idea(ts, i) else [])]
        if cg_ids:
            msg_ids = [m.id for cg in cg_ids for m in ts.execute(select(ChatMessage).where(ChatMessage.chat_group_id == cg)).scalars()]
            if msg_ids:
                ts.execute(Reaction.__table__.delete().where(Reaction.chat_message_id.in_(msg_ids)))
                ts.execute(ChatMention.__table__.delete().where(ChatMention.chat_message_id.in_(msg_ids)))
                ts.execute(Attachment.__table__.delete().where(Attachment.chat_message_id.in_(msg_ids)))
                ts.execute(Activity.__table__.delete().where(Activity.ref_id.in_(msg_ids)))
            ts.execute(ChatRead.__table__.delete().where(ChatRead.chat_group_id.in_(cg_ids)))
            ts.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_group_id.in_(cg_ids)))
            ts.execute(ChatGroup.__table__.delete().where(ChatGroup.id.in_(cg_ids)))
        if ideas:
            ts.execute(IdeaRevision.__table__.delete().where(IdeaRevision.idea_id.in_(ideas)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(ideas)))
        if quests:
            member_ids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(quests))).scalars())
            if member_ids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(member_ids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(quests)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(quests)))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.commit()


def _activity_count(env, *, reason, ref_id) -> int:
    with get_tenant_session(env.db_identifier) as ts:
        return len(list(ts.execute(select(Activity).where(Activity.reason == reason, Activity.ref_id == ref_id)).scalars()))


def test_e_tc_101_get_chat_empty(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r = client.get(CHAT(idea))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"] == [] and body["unread"]["unread_count"] == 0 and body["chat_group_id"]


def test_e_tc_102_post_message_and_xp(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r = _post(client, idea, body="こんにちは")
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert _activity_count(env, reason="chat", ref_id=uuid.UUID(mid)) == 1
    listed = client.get(CHAT(idea)).json()["data"]
    assert [m["body"] for m in listed] == ["こんにちは"]


def test_e_tc_103_empty_message(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    assert _post(client, idea, body="   ").status_code == 422


def test_e_tc_104_requires_comment(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_perms=["vote"])
    idea = env.make_idea(quest_id=qid, author=env.other_id)
    assert _post(client, idea, body="x").status_code == 403


def test_e_tc_105_gate_nonparty_and_draft(client, env):
    _login_seed(client)
    q2 = env.make_quest(owner=env.other_id, seed_member=False)
    non_party = env.make_idea(quest_id=q2, author=env.other_id)
    assert client.get(CHAT(non_party)).status_code == 404
    draft = env.make_idea(quest_id=env.make_quest(), status="draft")
    assert client.get(CHAT(draft)).status_code == 404


def test_e_tc_106_completed_frozen(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest(status="completed"))
    assert _post(client, idea, body="x").status_code == 409


def test_e_tc_107_mentions(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid)
    with get_tenant_session(env.db_identifier) as ts:  # 有効なメンション先＝パーティー員
        quests_repo.add_member(ts, qid, env.other_id, permissions=["comment"])
        ts.commit()
    ok = _post(client, idea, body="やあ", mentions=[env.other_id])
    assert ok.status_code == 201 and len(ok.json()["mentions"]) == 1
    bad = _post(client, idea, body="やあ", mentions=[uuid.uuid4()])
    assert bad.status_code == 422


def test_e_tc_108_reply_same_group(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    first = _post(client, idea, body="親").json()["id"]
    ok = _post(client, idea, body="返信", reply_to=first)
    assert ok.status_code == 201 and ok.json()["reply_to"]["excerpt"] == "親"
    # 別アイデアのメッセージを引用＝422。
    other_idea = env.make_idea(quest_id=env.make_quest())
    other_msg = _post(client, other_idea, body="別").json()["id"]
    assert _post(client, idea, body="x", reply_to=other_msg).status_code == 422


def test_e_tc_109_edit(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    mid = _post(client, idea, body="旧").json()["id"]
    r = client.patch(f"{MSGS}/{mid}", data={"body": "新"}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["is_edited"] is True and r.json()["body"] == "新"
    # 他人のメッセージは編集不可（他ユーザーの投稿を seed）。
    with get_tenant_session(env.db_identifier) as ts:
        cg = chat_repo.get_chat_group_by_idea(ts, idea)
        other_msg = chat_repo.create_message(ts, chat_group_id=cg.id, author_id=env.other_id, body="他")
        oid = other_msg.id
        ts.commit()
    assert client.patch(f"{MSGS}/{oid}", data={"body": "z"}, headers=_csrf(client)).status_code == 403


def test_e_tc_110_delete(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())  # ACME-01 owner
    mid = _post(client, idea, body="消す").json()["id"]
    r = client.delete(f"{MSGS}/{mid}", headers=_csrf(client))
    assert r.status_code == 200 and r.json()["is_deleted"] is True
    # 一覧でトゥームストーン化（body を返さない）。
    listed = client.get(CHAT(idea)).json()["data"]
    assert listed[0]["is_deleted"] is True and listed[0].get("body") is None
    # owner は他人の投稿も削除可。
    with get_tenant_session(env.db_identifier) as ts:
        cg = chat_repo.get_chat_group_by_idea(ts, idea)
        om = chat_repo.create_message(ts, chat_group_id=cg.id, author_id=env.other_id, body="他人")
        oid = om.id
        ts.commit()
    assert client.delete(f"{MSGS}/{oid}", headers=_csrf(client)).status_code == 200


def test_e_tc_111_read_unread(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    m1 = _post(client, idea, body="1").json()["id"]
    m2 = _post(client, idea, body="2").json()["id"]
    # m1 まで既読 → 未読は m2 の1件。
    assert client.post(f"{CHAT(idea)}/read", json={"last_read_message_id": m1}, headers=_csrf(client)).status_code == 200
    unread = client.get(CHAT(idea)).json()["unread"]
    assert unread["first_unread_message_id"] == m2 and unread["unread_count"] == 1
    # 古い位置の再送は後退しない（m1 送信後も m2 既読は維持されない＝ここでは m2 既読→m1 で後退しない）。
    client.post(f"{CHAT(idea)}/read", json={"last_read_message_id": m2}, headers=_csrf(client))
    client.post(f"{CHAT(idea)}/read", json={"last_read_message_id": m1}, headers=_csrf(client))
    assert client.get(CHAT(idea)).json()["unread"]["unread_count"] == 0


def test_e_tc_112_chat_activity(client, env):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    _post(client, idea, body="a")
    _post(client, idea, body="b")
    with get_tenant_session(env.db_identifier) as ts:
        ideas_repo.add_revision(ts, uuid.UUID(str(idea)), revision=1, editor_id=env.user_id, changes={"title": "I"})
        ts.commit()
    r = client.get(f"/api/v1/ideas/{idea}/chat-activity")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_messages"] == 2 and sum(d["message_count"] for d in body["daily"]) == 2
    assert any(m["revision"] == 1 for m in body["revision_markers"])


def test_e_tc_113_attachment_and_download(client, env, storage):
    _login_seed(client)
    idea = env.make_idea(quest_id=env.make_quest())
    r = _post(client, idea, body="", files=[("files", ("z.png", PNG, "image/png"))])
    assert r.status_code == 201, r.text
    atts = r.json()["attachments"]
    assert len(atts) == 1 and atts[0]["kind"] == "image"
    d = client.get(f"/api/v1/attachments/{atts[0]['id']}/download")
    assert d.status_code == 200 and d.json()["url"]


def test_e_tc_114_csrf_and_unauth(client, env):
    idea = env.make_idea(quest_id=env.make_quest())
    assert client.post(MSGS, data={"idea_id": str(idea), "body": "x"}).status_code == 401
    _login_seed(client)
    assert client.post(MSGS, data={"idea_id": str(idea), "body": "x"}).status_code == 403
