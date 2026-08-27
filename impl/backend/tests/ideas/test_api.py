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
            idea = repo.create_idea(ts, idea_id=iid, quest_id=quest_id, author_id=author or user_id, title=title, value=value, body=body, status=status)
            # 公開 seed は不変条件「published ⇒ 初版 revision=1 が存在」を満たす（実 API の _publish_processing 相当・D.4）。
            if status == "published":
                ts.flush()
                repo.add_revision(
                    ts, iid, revision=idea.current_revision, editor_id=author or user_id,
                    changes={"title": title, "value": value, "body": body, "time_limit": None, "note": None, "stakeholders": []},
                )
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
            # 公開で作られる chat_groups（E・§5.15）も掃除（FK: chat_groups.idea_id）。
            from app.tenant.chat.orm import ChatGroup
            ts.execute(ChatGroup.__table__.delete().where(ChatGroup.idea_id.in_(iids)))
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
        # 初版 revision=1（公開時）＋編集 revision=2 の2件（D.4 line104・D-TC-142）。
        assert [r.revision for r in repo.list_revisions(ts, pub)] == [2, 1]


def test_d_tc_143_concurrent_edit_conflict(client, env):
    """D-TC-143 公開アイデアの並行 PATCH は 409 edit_conflict（UNIQUE(idea_id,revision) 楽観ロック・D.2 line67）。500 にしない。"""
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")  # current_revision=1・revision 1 存在
    # 別編集者が既に revision 2 を作成済み（＝自分の current_revision=1 は stale）状態を再現
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_revision(
            ts, pub, revision=2, editor_id=env.user_id,
            changes={"title": "other", "value": "v", "body": "b", "time_limit": None, "note": None, "stakeholders": []},
        )
        ts.commit()
    # next_rev=2 の INSERT が UNIQUE 違反 → 409 edit_conflict（500 でなく）
    r = client.patch(IDEA(pub), json={"title": "mine"}, headers=_csrf(client))
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "edit_conflict"


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


# ---- D-TC-131〜137: 添付（D.3・MinIO/multipart） ----

ATTACH = lambda iid: f"/api/v1/ideas/{iid}/attachments"  # noqa: E731
DOWNLOAD = lambda aid: f"/api/v1/attachments/{aid}/download"  # noqa: E731
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def test_d_tc_131_add_attachments_and_detail(client, env, storage):
    """D-TC-131: 添付追加（png+pdf）→ 201・詳細にも反映。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(ATTACH(idea), files=[
        ("files", ("a.png", PNG, "image/png")),
        ("files", ("b.pdf", b"%PDF-1.4 test", "application/pdf")),
    ], headers=_csrf(client))
    assert r.status_code == 201, r.text
    atts = r.json()["attachments"]
    assert len(atts) == 2
    names = {a["original_name"] for a in atts}
    assert names == {"a.png", "b.pdf"}
    assert all("uploaded_by" in a and "id" in a for a in atts)
    detail = client.get(IDEA(idea)).json()
    assert len(detail["attachments"]) == 2


def test_d_tc_132_attachment_count_limit(client, env, storage):
    """D-TC-132: 既存9件＋今回2件＝11 は 422 too_many。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    with get_tenant_session(env.db_identifier) as ts:
        for i in range(9):
            repo.add_attachment(ts, idea_id=idea, object_key=f"k{i}", original_name=f"f{i}.txt",
                                size_bytes=1, mime_type="text/plain", uploaded_by_id=env.user_id)
        ts.commit()
    r = client.post(ATTACH(idea), files=[
        ("files", ("x.png", PNG, "image/png")),
        ("files", ("y.pdf", b"%PDF-1.4", "application/pdf")),
    ], headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e.get("code") == "too_many" for e in r.json().get("errors", []))


def test_d_tc_133_attachment_mime_not_allowed(client, env, storage):
    """D-TC-133: 不許可拡張子は 422 mime_not_allowed。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(ATTACH(idea), files=[("files", ("evil.exe", b"MZ", "application/octet-stream"))], headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e.get("code") == "mime_not_allowed" for e in r.json().get("errors", []))


def test_d_tc_134_delete_attachment(client, env, storage):
    """D-TC-134: 添付削除＝204・詳細から消える・storage からも remove。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(ATTACH(idea), files=[("files", ("a.png", PNG, "image/png"))], headers=_csrf(client))
    aid = r.json()["attachments"][0]["id"]
    assert len(storage.objects) == 1
    assert client.delete(f"{ATTACH(idea)}/{aid}", headers=_csrf(client)).status_code == 204
    assert client.get(IDEA(idea)).json()["attachments"] == []
    assert len(storage.objects) == 0


def test_d_tc_135_add_requires_edit_permission(client, env, storage):
    """D-TC-135: 他人のアイデア（自分は vote のみ）への添付追加は 403。"""
    _login_seed(client)
    qid = env.make_quest(owner=env.other_id, seed_member=True, seed_perms=["vote"])
    idea = env.make_idea(quest_id=qid, status="published", author=env.other_id)
    r = client.post(ATTACH(idea), files=[("files", ("a.png", PNG, "image/png"))], headers=_csrf(client))
    assert r.status_code == 403, r.text


def test_d_tc_136_download_returns_signed_url(client, env, storage):
    """D-TC-136: DL はパーティー所属→署名URL を返す。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(ATTACH(idea), files=[("files", ("a.png", PNG, "image/png"))], headers=_csrf(client))
    aid = r.json()["attachments"][0]["id"]
    d = client.get(DOWNLOAD(aid))
    assert d.status_code == 200, d.text
    assert isinstance(d.json()["url"], str) and d.json()["url"]


def test_d_tc_137_completed_quest_freezes_attachments(client, env, storage):
    """D-TC-137: 完了クエストは添付追加を 409（凍結）。"""
    _login_seed(client)
    qid = env.make_quest(status="completed")
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(ATTACH(idea), files=[("files", ("a.png", PNG, "image/png"))], headers=_csrf(client))
    assert r.status_code == 409, r.text


# ---- 版・差分（D.4・D-TC-138〜142） ----

REVS = lambda iid: f"/api/v1/ideas/{iid}/revisions"  # noqa: E731
DIFF = lambda iid, rev: f"/api/v1/ideas/{iid}/revisions/{rev}/diff"  # noqa: E731


def test_d_tc_142_publish_records_initial_revision(client, env):
    """D-TC-142: 公開処理で初版 revision=1 を記録（通知なし）＝publish／作成公開の双方。changed_fields=[]・current_revision=1。"""
    _login_seed(client)
    qid = env.make_quest()
    # (a) 下書きを publish → 初版 revision=1。
    draft = env.make_idea(quest_id=qid, status="draft")
    assert client.post(f"{IDEA(draft)}/publish", json={}, headers=_csrf(client)).status_code == 200
    rr = client.get(REVS(draft))
    assert rr.status_code == 200, rr.text
    data = rr.json()["data"]
    assert [r["revision"] for r in data] == [1]
    assert data[0]["changed_fields"] == [] and data[0]["editor"]["display_name"]
    assert client.get(IDEA(draft)).json()["current_revision"] == 1
    # (b) 作成即公開（POST ideas・published）も初版 revision=1。
    cr = client.post(IDEAS(qid), json={"title": "T", "value": "v", "body": "b", "status": "published"}, headers=_csrf(client))
    assert cr.status_code == 201, cr.text
    pub = cr.json()["id"]
    assert [r["revision"] for r in client.get(REVS(pub)).json()["data"]] == [1]


def test_d_tc_138_revision_timeline(client, env):
    """D-TC-138: 版タイムライン＝新しい順・editor/created_at/changed_fields/memo・初版含む。"""
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")  # 初版 revision=1（seed）
    assert client.patch(IDEA(pub), json={"title": "T2"}, headers=_csrf(client)).status_code == 200  # rev2
    assert client.patch(IDEA(pub), json={"body": "B3"}, headers=_csrf(client)).status_code == 200   # rev3
    rr = client.get(REVS(pub))
    assert rr.status_code == 200, rr.text
    data = rr.json()["data"]
    assert [r["revision"] for r in data] == [3, 2, 1]  # 新しい順
    by_rev = {r["revision"]: r for r in data}
    assert by_rev[1]["changed_fields"] == []           # 初版は空
    assert by_rev[2]["changed_fields"] == ["title"]    # 前版比＝title
    assert by_rev[3]["changed_fields"] == ["body"]     # 前版比＝body
    assert all(r["created_at"] and r["editor"]["display_name"] for r in data)


def test_d_tc_139_revision_timeline_gated(client, env):
    """D-TC-139: 版タイムラインは門番（非パーティー404）＋下書きは本人のみ（他人下書き404）。"""
    _login_seed(client)
    q2 = env.make_quest(owner=env.other_id, seed_member=False)
    non_party = env.make_idea(quest_id=q2, status="published", author=env.other_id)
    assert client.get(REVS(non_party)).status_code == 404
    qid = env.make_quest()
    others_draft = env.make_idea(quest_id=qid, status="draft", author=env.other_id)
    assert client.get(REVS(others_draft)).status_code == 404


def test_d_tc_140_revision_diff_default_prev(client, env):
    """D-TC-140: 差分（既定＝前版比較）＝テキスト系は segments・その他は {old,new}。存在しない版は 404。"""
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")  # rev1（value="v", body="b", time_limit=None）
    # 本文/価値/タイムリミットを編集 → rev2。
    assert client.patch(IDEA(pub), json={"body": "b2", "value": "v2", "time_limit": "2027-01-01"}, headers=_csrf(client)).status_code == 200
    dd = client.get(DIFF(pub, 2))
    assert dd.status_code == 200, dd.text
    body = dd.json()
    assert body["from_revision"] == 1 and body["to_revision"] == 2
    fields = body["fields"]
    assert "title" not in fields                       # 未変更は含まない
    assert fields["body"]["kind"] == "text" and any(s["op"] == "add" for s in fields["body"]["segments"])
    assert fields["value"]["kind"] == "text"
    assert fields["time_limit"]["kind"] == "scalar" and fields["time_limit"]["old"] is None and fields["time_limit"]["new"] == "2027-01-01"
    assert client.get(DIFF(pub, 99)).status_code == 404  # 存在しない版


def test_d_tc_141_revision_diff_from_explicit(client, env):
    """D-TC-141: from 明示（投票時点差分）＝from=1 で初版からの累積差分。from>revision は 422。"""
    _login_seed(client)
    qid = env.make_quest()
    pub = env.make_idea(quest_id=qid, status="published")  # rev1
    assert client.patch(IDEA(pub), json={"title": "T2"}, headers=_csrf(client)).status_code == 200  # rev2
    assert client.patch(IDEA(pub), json={"body": "B3"}, headers=_csrf(client)).status_code == 200   # rev3
    dd = client.get(f"{DIFF(pub, 3)}?from=1")
    assert dd.status_code == 200, dd.text
    body = dd.json()
    assert body["from_revision"] == 1 and body["to_revision"] == 3
    assert "title" in body["fields"] and "body" in body["fields"]  # 初版からは title/body 両方変化
    # from > revision は 422。
    assert client.get(f"{DIFF(pub, 2)}?from=5").status_code == 422


def test_d_tc_151_ideas_list_comment_count(client, env):
    """D-TC-151 一覧カードのコメント数（E・非削除のみ・SC-12 💬）。"""
    from app.tenant.chat.orm import ChatGroup, ChatMessage

    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid)
    no_chat = env.make_idea(quest_id=qid)
    cg = uuid.uuid4()
    with get_tenant_session(env.db_identifier) as ts:
        ts.add(ChatGroup(id=cg, idea_id=idea))
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cg, author_id=env.user_id, body="c1"))
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cg, author_id=env.user_id, body="c2"))
        ts.add(ChatMessage(id=uuid.uuid4(), chat_group_id=cg, author_id=env.user_id, body="del", is_deleted=True))
        ts.commit()
    try:
        cards = {c["id"]: c for c in client.get(IDEAS(qid)).json()["data"]}
        assert cards[str(idea)]["comment_count"] == 2       # 非削除2（削除1は除外）
        assert cards[str(no_chat)]["comment_count"] == 0     # chat 無し
    finally:
        with get_tenant_session(env.db_identifier) as ts:
            ts.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_group_id == cg))
            ts.execute(ChatGroup.__table__.delete().where(ChatGroup.id == cg))
            ts.commit()


# ---- XP 付与（G 結線・§8-⑥・FR-01/FR-23） ----
from app.tenant.gamification.orm import Activity  # noqa: E402
from app.tenant.ideas import application as _ideas_app  # noqa: E402


def _acts(db_identifier, user_id, reason, ref_id=None):
    with get_tenant_session(db_identifier) as ts:
        q = ts.query(Activity).filter_by(user_id=user_id, reason=reason)
        if ref_id is not None:
            q = q.filter_by(ref_id=ref_id)
        return [(a.amount, a.kind, str(a.ref_type)) for a in q.all()]


def test_d_tc_160_publish_awards_idea_post_xp(client, factory, env):
    """D-TC-160 公開で投稿 XP+50（idea_post・冪等・FR-01/§8-⑥）。"""
    _login_seed(client)
    qid = env.make_quest()
    draft = env.make_idea(quest_id=qid, status="draft")
    r = client.post(f"/api/v1/ideas/{draft}/publish", json={}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    acts = _acts(env.db_identifier, env.user_id, "idea_post", draft)
    assert acts == [(50, "xp_gain", "ideas")]              # +50 が1件
    # 二重公開は 409・加算なし（冪等）。
    assert client.post(f"/api/v1/ideas/{draft}/publish", json={}, headers=_csrf(client)).status_code == 409
    assert len(_acts(env.db_identifier, env.user_id, "idea_post", draft)) == 1


def test_d_tc_161_vote_xp_first_only(factory, env):
    """D-TC-161 投票 XP+5（各アイデア初回のみ・切替/再投票は追加なし・FR-23/§8-⑥）。"""
    qid = env.make_quest()
    idea_id = env.make_idea(quest_id=qid)
    voter = factory.make_seed_company_account()  # fresh user＝日次カウント隔離（teardown で activities 掃除）
    with get_tenant_session(env.db_identifier) as ts:
        vu, idea = get_user_by_account(ts, voter["id"]), repo.get_idea(ts, idea_id)
        assert _ideas_app._award_vote_xp(ts, idea, vu, True) is True    # 初回＝付与
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        vu, idea = get_user_by_account(ts, voter["id"]), repo.get_idea(ts, idea_id)
        assert _ideas_app._award_vote_xp(ts, idea, vu, False) is False  # 同一アイデアは冪等（追加なし）
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        vu = get_user_by_account(ts, voter["id"])
        assert _acts(env.db_identifier, vu.id, "vote", idea_id) == [(5, "xp_gain", "ideas")]


def test_d_tc_162_vote_xp_daily_cap(factory, env):
    """D-TC-162 投票 XP は日次上限5/日（6件目は付与なし・§8-⑥）。"""
    qid = env.make_quest()
    ideas = [env.make_idea(quest_id=qid) for _ in range(6)]
    voter = factory.make_seed_company_account()
    granted = []
    for iid in ideas:
        with get_tenant_session(env.db_identifier) as ts:
            vu, idea = get_user_by_account(ts, voter["id"]), repo.get_idea(ts, iid)
            granted.append(_ideas_app._award_vote_xp(ts, idea, vu, True))
            ts.commit()
    assert granted == [True, True, True, True, True, False]  # 6件目は日次上限で付与なし


def test_sec_tc_011_attachment_signature_mismatch(client, env):
    """SEC-TC-011 拡張子 .png だが中身が非PNG→422 signature_mismatch（拡張子偽装拒否・§8）。"""
    _login_seed(client)
    qid = env.make_quest()
    idea = env.make_idea(quest_id=qid, status="published")
    r = client.post(ATTACH(idea), files=[("files", ("a.png", b"not a real png", "image/png"))], headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e.get("code") == "signature_mismatch" for e in r.json().get("errors", []))


def test_sec_tc_040_idea_create_mass_assignment_forbidden(client, env):
    """SEC-TC-040 作成 request は extra=forbid＝サーバー制御列（is_selected 等）の混入は 422（Mass Assignment 防止）。"""
    _login_seed(client)
    qid = env.make_quest()
    r = client.post(IDEAS(qid), json={"title": "T", "value": "V", "body": "B", "status": "draft",
                                      "is_selected": True}, headers=_csrf(client))
    assert r.status_code == 422, r.text  # extra=forbid（§2.2）
