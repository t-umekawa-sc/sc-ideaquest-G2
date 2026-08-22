"""D-TC-001〜012: ideas repository の永続化プリミティブ（API設計 D.1〜D.6・§5.10〜§5.14・§5.23）。

対象＝`app/tenant/ideas/repository.py`。前提（クエスト/ユーザー）は SUT を介さず ORM で直接 seed して独立させる。
repository 関数は呼び出し側 Tx に相乗（自身では commit しない）ため、テストが commit し別セッションで再取得して検証する。
ACME-01 会社DB を使い teardown で作成データを物理削除。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ideas import repository as repo
from app.tenant.ideas.orm import Attachment, Follow, Idea, IdeaRevision, IdeaStakeholder, Vote
from app.tenant.profile.orm import User
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests.orm import Quest
from tests.conftest import SEED_COMPANY_CODE


@pytest.fixture
def env():
    """ACME-01 会社DB にグループ1・クエスト1・ユーザー2名を用意。teardown で作成データを物理削除。"""
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier

    group_id = uuid.uuid4()
    quest_id = uuid.uuid4()
    author_id = uuid.uuid4()
    other_id = uuid.uuid4()
    created_ideas: list[uuid.UUID] = []

    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        for uid, name in ((author_id, "Author"), (other_id, "Other")):
            ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=name, locale="ja", status="active"))
        ts.flush()
        ts.add(Quest(id=quest_id, quest_group_id=group_id, owner_id=author_id, title="Q", color="#3B82F6", status="recruiting"))
        ts.commit()

    def new_idea(*, status="published", author=None, quest=None, idea_id=None) -> uuid.UUID:
        iid = idea_id or uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            repo.create_idea(
                ts, idea_id=iid, quest_id=quest or quest_id, author_id=author or author_id,
                title="I", body="b", value="v", status=status,
            )
            ts.commit()
        created_ideas.append(iid)
        return iid

    yield SimpleNamespace(
        db_identifier=db_identifier, group_id=group_id, quest_id=quest_id,
        author_id=author_id, other_id=other_id, new_idea=new_idea, created_ideas=created_ideas,
    )

    with get_tenant_session(db_identifier) as ts:
        iids = list(created_ideas)
        if iids:
            ts.execute(Attachment.__table__.delete().where(Attachment.idea_id.in_(iids)))
            ts.execute(Vote.__table__.delete().where(Vote.idea_id.in_(iids)))
            ts.execute(IdeaRevision.__table__.delete().where(IdeaRevision.idea_id.in_(iids)))
            ts.execute(IdeaStakeholder.__table__.delete().where(IdeaStakeholder.idea_id.in_(iids)))
            ts.execute(Follow.__table__.delete().where(Follow.idea_id.in_(iids)))
            ts.execute(Idea.__table__.delete().where(Idea.id.in_(iids)))
        ts.execute(Quest.__table__.delete().where(Quest.id == quest_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id.in_([author_id, other_id])))
        ts.commit()


def test_d_tc_001_create_and_get_active(env):
    """D-TC-001: create_idea→get_idea は有効行を返す。deleted は None（トゥームストーン除外）。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        got = repo.get_idea(ts, iid)
        assert got is not None and got.author_id == env.author_id and got.current_revision == 1
        got.deleted_at = datetime.now(timezone.utc)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_idea(ts, iid) is None


def test_d_tc_002_list_visibility(env):
    """D-TC-002: 一覧は公開＋自分の下書きのみ。他人の下書きは除外。"""
    published = env.new_idea(status="published")
    my_draft = env.new_idea(status="draft", author=env.author_id)
    others_draft = env.new_idea(status="draft", author=env.other_id)
    with get_tenant_session(env.db_identifier) as ts:
        ids = {i.id for i in repo.list_ideas_for_quest(ts, quest_id=env.quest_id, viewer_id=env.author_id, limit=50)}
    assert published in ids and my_draft in ids and others_draft not in ids


def test_d_tc_003_list_status_filter(env):
    """D-TC-003: status=['published'] は公開のみ（自分の下書きも除外）。"""
    published = env.new_idea(status="published")
    my_draft = env.new_idea(status="draft", author=env.author_id)
    with get_tenant_session(env.db_identifier) as ts:
        ids = {i.id for i in repo.list_ideas_for_quest(ts, quest_id=env.quest_id, viewer_id=env.author_id, status=["published"], limit=50)}
    assert published in ids and my_draft not in ids


def test_d_tc_004_list_cursor_pagination(env):
    """D-TC-004: カーソルページング＝(created_at,id) DESC で重複なく続きを返す。"""
    for _ in range(3):
        env.new_idea(status="published")
    with get_tenant_session(env.db_identifier) as ts:
        page1 = repo.list_ideas_for_quest(ts, quest_id=env.quest_id, viewer_id=env.author_id, limit=2)
        assert len(page1) == 2
        last = page1[-1]
        page2 = repo.list_ideas_for_quest(ts, quest_id=env.quest_id, viewer_id=env.author_id, cursor=(last.created_at, last.id), limit=2)
    assert {i.id for i in page1}.isdisjoint({i.id for i in page2})


def test_d_tc_005_replace_stakeholders(env):
    """D-TC-005: replace_stakeholders は置換セット（旧を消し新のみ残る）。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        repo.replace_stakeholders(ts, iid, [("経理", False), ("現場", True)])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        repo.replace_stakeholders(ts, iid, [("物流", False)])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        labels = [s.label for s in repo.list_stakeholders(ts, iid)]
    assert labels == ["物流"]


def test_d_tc_006_upsert_vote_first_time_then_switch(env):
    """D-TC-006: 初回投票は created=True、切替は created=False（1人1票・§5.13）。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        _, created1 = repo.upsert_vote(ts, iid, env.author_id, type="approve", voted_revision=1)
        ts.commit()
        assert created1 is True
    with get_tenant_session(env.db_identifier) as ts:
        v, created2 = repo.upsert_vote(ts, iid, env.author_id, type="oppose", voted_revision=1)
        ts.commit()
        assert created2 is False and v.type == "oppose"
        rows = ts.execute(select(Vote).where(Vote.idea_id == iid, Vote.user_id == env.author_id)).scalars().all()
        assert len(rows) == 1  # 1人1票


def test_d_tc_007_count_votes(env):
    """D-TC-007: count_votes は賛成/反対を集計。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        repo.upsert_vote(ts, iid, env.author_id, type="approve", voted_revision=1)
        repo.upsert_vote(ts, iid, env.other_id, type="oppose", voted_revision=1)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.count_votes(ts, iid) == {"approve": 1, "oppose": 1}


def test_d_tc_008_remove_vote_idempotent(env):
    """D-TC-008: remove_vote は削除で True、無ければ False（冪等）。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        repo.upsert_vote(ts, iid, env.author_id, type="approve", voted_revision=1)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.remove_vote(ts, iid, env.author_id) is True
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.remove_vote(ts, iid, env.author_id) is False


def test_d_tc_009_revisions_add_list_get(env):
    """D-TC-009: add_revision→list（新しい順）／get_revision。UNIQUE(idea_id,revision)。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_revision(ts, iid, revision=1, editor_id=env.author_id, changes={"title": "a"})
        repo.add_revision(ts, iid, revision=2, editor_id=env.author_id, changes={"title": "b"}, memo="m")
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        revs = repo.list_revisions(ts, iid)
        assert [r.revision for r in revs] == [2, 1]  # 新しい順
        assert repo.get_revision(ts, iid, 2).changes == {"title": "b"}


def test_d_tc_010_attachments_add_count_remove(env):
    """D-TC-010: add_attachment→list/count→remove。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        a = repo.add_attachment(ts, idea_id=iid, object_key="k/x.pdf", original_name="x.pdf", size_bytes=100, mime_type="application/pdf", uploaded_by_id=env.author_id)
        aid = a.id
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.count_attachments(ts, iid) == 1
        att = repo.get_attachment(ts, aid)
        repo.remove_attachment(ts, att)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.count_attachments(ts, iid) == 0


def test_d_tc_011_follow_idempotent(env):
    """D-TC-011: add_follow は冪等（重複行を作らない）／remove_follow・is_following。"""
    iid = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_follow(ts, env.author_id, iid)
        repo.add_follow(ts, env.author_id, iid)  # 冪等
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.is_following(ts, env.author_id, iid) is True
        rows = ts.execute(select(Follow).where(Follow.user_id == env.author_id, Follow.idea_id == iid)).scalars().all()
        assert len(rows) == 1
        assert repo.remove_follow(ts, env.author_id, iid) is True
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.is_following(ts, env.author_id, iid) is False


def test_d_tc_012_list_followed_idea_ids(env):
    """D-TC-012: list_followed_idea_ids は自分がフォロー中のアイデア集合。"""
    a = env.new_idea()
    b = env.new_idea()
    with get_tenant_session(env.db_identifier) as ts:
        repo.add_follow(ts, env.author_id, a)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        followed = repo.list_followed_idea_ids(ts, env.author_id)
    assert a in followed and b not in followed
