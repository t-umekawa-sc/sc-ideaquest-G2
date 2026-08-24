"""D-TC-101〜118: アイデア作成/一覧/詳細/編集/公開/削除 API（SC-21/12/22・D.1/D.2）。

seed 一般ユーザー（ACME-01）でログインし、会社DB にクエスト＋自分のパーティー参加を直接 seed。
門番（パーティー所属）・権限（idea_create／投稿者 or owner/quest_admin）・状態機械・可視性を検証。teardown で物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ideas import repository as repo
from app.tenant.ideas.orm import Attachment, Follow, Idea, IdeaRevision, IdeaStakeholder, Vote
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestCategory, QuestMember, QuestMemberPermission
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user = get_user_by_account(ts, account.id)
        user_id = user.id

    group_id = uuid.uuid4()
    other_id = uuid.uuid4()
    quests: list[uuid.UUID] = []
    ideas: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Other", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, owner=None, seed_member=True, seed_perms=None, status="recruiting") -> uuid.UUID:
        qid = uuid.uuid4()
        the_owner = owner or user_id
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, quest_group_id=group_id, owner_id=the_owner, title="Q", color="#3B82F6", status=status)
            quests_repo.add_member(ts, qid, the_owner, permissions=["owner"])
            if seed_member and the_owner != user_id:
                quests_repo.add_member(ts, qid, user_id, permissions=seed_perms or ["vote", "idea_create", "comment"])
            ts.commit()
        quests.append(qid)
        return qid

    def make_idea(*, quest_id, author=None, status="published", title="I", value="v", body="b") -> uuid.UUID:
        iid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            repo.create_idea(ts, idea_id=iid, quest_id=quest_id, author_id=author or user_id, title=title, value=value, body=body, status=status)
            ts.commit()
        ideas.append(iid)
        return iid

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, other_id=other_id, group_id=group_id,
        make_quest=make_quest, make_idea=make_idea, ideas=ideas,
    )

    with get_tenant_session(db_identifier) as ts:
        # API が作ったアイデアも quest 経由で掃除。
        api_ideas = list(ts.execute(select(Idea.id).where(Idea.quest_id.in_(quests or [uuid.uuid4()]))).scalars())
        iids = list(set(ideas) | set(api_ideas))
        if iids:
            ts.execute(IdeaStakeholder.__table__.delete().where(IdeaStakeholder.idea_id.in_(iids)))
            ts.execute(Vote.__table__.delete().where(Vote.idea_id.in_(iids)))
            ts.execute(IdeaRevision.__table__.delete().where(IdeaRevision.idea_id.in_(iids)))
            ts.execute(Attachment.__table__.delete().where(Attachment.idea_id.in_(iids)))
            ts.execute(Follow.__table__.delete().where(Follow.idea_id.in_(iids)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(iids)))
        if quests:
            mids = list(ts.execute(select(QuestMember.id).where(QuestMember.quest_id.in_(quests))).scalars())
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id.in_(quests)))
            ts.execute(QuestCategory.__table__.delete().where(QuestCategory.quest_id.in_(quests)))
            ts.execute(Quest.__table__.delete().where(Quest.id.in_(quests)))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.commit()


IDEAS = lambda qid: f"/api/v1/quests/{qid}/ideas"  # noqa: E731
IDEA = lambda iid: f"/api/v1/ideas/{iid}"  # noqa: E731


def test_d_tc_101_create_draft(client, env):
    _login_seed(client)
    qid = env.make_quest()
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "B", "status": "draft"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "draft" and b["my_state"] == "draft" and b["author"]["user_id"] == str(env.user_id)


def test_d_tc_102_create_published(client, env):
    _login_seed(client)
    qid = env.make_quest()
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "B", "status": "published"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "published"


def test_d_tc_103_create_requires_idea_create(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["vote", "comment"])
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "B", "status": "draft"}, headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_d_tc_104_create_published_strict(client, env):
    _login_seed(client)
    qid = env.make_quest()
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "", "status": "published"}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e["field"] == "body" for e in r.json()["errors"])


def test_d_tc_105_list_visibility(client, env):
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")
    mine = env.make_idea(quest_id=qid, status="draft", author=env.user_id)
    others = env.make_idea(quest_id=qid, status="draft", author=env.other_id)
    r = client.get(IDEAS(qid))
    assert r.status_code == 200, r.text
    ids = {c["id"] for c in r.json()["data"]}
    assert str(pub) in ids and str(mine) in ids and str(others) not in ids


def test_d_tc_106_list_requires_membership(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=False)
    r = client.get(IDEAS(qid))
    assert r.status_code == 404, r.text


def test_d_tc_107_detail_own(client, env):
    _login_seed(client)
    qid = env.make_quest()
    draft = env.make_idea(quest_id=qid, status="draft")
    pub = env.make_idea(quest_id=qid, status="published")
    assert client.get(IDEA(draft)).status_code == 200
    r = client.get(IDEA(pub))
    assert r.status_code == 200 and "vote" in r.json() and "my_permissions" in r.json()


def test_d_tc_130_detail_has_quest_ref(client, env):
    """D-TC-130: 詳細に quest 参照（id/title/status/categories/deadline）が入る（SC-22 導線用）。"""
    _login_seed(client)
    qid = env.make_quest()
    with get_tenant_session(env.db_identifier) as ts:
        quests_repo.replace_categories(ts, qid, [("UX", False), ("業務改善", False)])
        ts.commit()
    pub = env.make_idea(quest_id=qid, status="published")
    r = client.get(IDEA(pub))
    assert r.status_code == 200, r.text
    quest = r.json()["quest"]
    assert quest["id"] == str(qid)
    assert quest["title"] == "Q"
    assert quest["status"] == "recruiting"
    assert set(quest["categories"]) == {"UX", "業務改善"}
    assert "deadline" in quest


def test_d_tc_108_detail_hidden(client, env):
    _login_seed(client)
    qid = env.make_quest()
    others_draft = env.make_idea(quest_id=qid, status="draft", author=env.other_id)
    assert client.get(IDEA(others_draft)).status_code == 404
    q2 = env.make_quest(owner=env.other_id, seed_member=False)
    pub = env.make_idea(quest_id=q2, status="published", author=env.other_id)
    assert client.get(IDEA(pub)).status_code == 404  # 非パーティー


def test_d_tc_109_edit_draft_vs_published_revision(client, env):
    _login_seed(client)
    qid = env.make_quest()
    draft = env.make_idea(quest_id=qid, status="draft")
    r1 = client.patch(IDEA(draft), json={"title": "T2"}, headers=_csrf(client))
    assert r1.status_code == 200 and r1.json()["current_revision"] == 1  # 下書きは版なし
    pub = env.make_idea(quest_id=qid, status="published")
    r2 = client.patch(IDEA(pub), json={"title": "T3"}, headers=_csrf(client))
    assert r2.status_code == 200 and r2.json()["current_revision"] == 2  # 公開中は版記録
    with get_tenant_session(env.db_identifier) as ts:
        assert len(repo.list_revisions(ts, pub)) == 1


def test_d_tc_110_edit_published_strict(client, env):
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")
    r = client.patch(IDEA(pub), json={"body": ""}, headers=_csrf(client))
    assert r.status_code == 422, r.text


def test_d_tc_111_edit_completed_frozen(client, env):
    _login_seed(client)
    qid = env.make_quest(status="completed")
    pub = env.make_idea(quest_id=qid, status="published")
    r = client.patch(IDEA(pub), json={"title": "X"}, headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_d_tc_112_publish_draft(client, env):
    _login_seed(client)
    qid = env.make_quest()
    draft = env.make_idea(quest_id=qid, status="draft")
    r = client.post(f"{IDEA(draft)}/publish", json={}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "published"


def test_d_tc_113_publish_non_draft_conflicts(client, env):
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")
    r = client.post(f"{IDEA(pub)}/publish", json={}, headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_d_tc_114_edit_authorization(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["vote"])
    pub = env.make_idea(quest_id=qid, status="published", author=env.other_id)
    assert client.patch(IDEA(pub), json={"title": "X"}, headers=_csrf(client)).status_code == 403


def test_d_tc_115_delete(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    assert client.delete(IDEA(idea), headers=_csrf(client)).status_code == 204
    assert client.get(IDEA(idea)).status_code == 404


def test_d_tc_116_delete_authorization(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["vote"])
    pub = env.make_idea(quest_id=qid, status="published", author=env.other_id)
    assert client.delete(IDEA(pub), headers=_csrf(client)).status_code == 403


def test_d_tc_117_create_requires_csrf(client, env):
    _login_seed(client)
    qid = env.make_quest()
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "B", "status": "draft"})
    assert r.status_code == 403 and r.json()["code"] == "csrf_failed"


def test_d_tc_118_create_requires_auth(client, env):
    qid = env.make_quest()
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "B", "status": "draft"})
    assert r.status_code == 401, r.text


# ---- D-TC-119〜129: 投票（D.5）・フォロー（D.6） ----

VOTE = lambda iid: f"/api/v1/ideas/{iid}/vote"  # noqa: E731
FOLLOW = lambda iid: f"/api/v1/ideas/{iid}/follow"  # noqa: E731


def test_d_tc_119_vote_approve(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(VOTE(idea), json={"type": "approve"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["my_vote"] == "approve" and b["summary"]["approve"] == 1 and b["summary"]["oppose"] == 0


def test_d_tc_120_vote_switch_one_per_user(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    client.post(VOTE(idea), json={"type": "approve"}, headers=_csrf(client))
    r = client.post(VOTE(idea), json={"type": "oppose"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["my_vote"] == "oppose" and b["summary"]["approve"] == 0 and b["summary"]["oppose"] == 1


def test_d_tc_121_vote_cancel_idempotent(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    client.post(VOTE(idea), json={"type": "approve"}, headers=_csrf(client))
    assert client.delete(VOTE(idea), headers=_csrf(client)).status_code == 204
    assert client.delete(VOTE(idea), headers=_csrf(client)).status_code == 204


def test_d_tc_122_vote_requires_vote_permission(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["idea_create", "comment"])
    idea = env.make_idea(quest_id=qid, status="published", author=env.other_id)
    r = client.post(VOTE(idea), json={"type": "approve"}, headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_d_tc_123_vote_draft_forbidden(client, env):
    _login_seed(client)
    qid = env.make_quest()
    draft = env.make_idea(quest_id=qid, status="draft")
    r = client.post(VOTE(draft), json={"type": "approve"}, headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_d_tc_124_vote_frozen_on_completed(client, env):
    _login_seed(client)
    qid = env.make_quest(status="completed")
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(VOTE(idea), json={"type": "approve"}, headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_d_tc_125_vote_requires_membership(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=False)
    idea = env.make_idea(quest_id=qid, status="published", author=env.other_id)
    r = client.post(VOTE(idea), json={"type": "approve"}, headers=_csrf(client))
    assert r.status_code == 404, r.text


def test_d_tc_126_follow_idempotent(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    assert client.post(FOLLOW(idea), headers=_csrf(client)).status_code == 204
    assert client.post(FOLLOW(idea), headers=_csrf(client)).status_code == 204
    assert client.get(IDEA(idea)).json()["following"] is True


def test_d_tc_127_unfollow_idempotent(client, env):
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    client.post(FOLLOW(idea), headers=_csrf(client))
    assert client.delete(FOLLOW(idea), headers=_csrf(client)).status_code == 204
    assert client.delete(FOLLOW(idea), headers=_csrf(client)).status_code == 204
    assert client.get(IDEA(idea)).json()["following"] is False


def test_d_tc_128_follow_frozen_new_but_unfollow_ok(client, env):
    _login_seed(client)
    qid = env.make_quest(status="completed")
    idea = env.make_idea(quest_id=qid, status="published")
    assert client.post(FOLLOW(idea), headers=_csrf(client)).status_code == 409
    assert client.delete(FOLLOW(idea), headers=_csrf(client)).status_code == 204


def test_d_tc_129_follow_requires_membership(client, env):
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=False)
    idea = env.make_idea(quest_id=qid, status="published", author=env.other_id)
    r = client.post(FOLLOW(idea), headers=_csrf(client))
    assert r.status_code == 404, r.text
