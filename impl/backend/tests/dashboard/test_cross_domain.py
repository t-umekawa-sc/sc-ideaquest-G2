"""I-TC-131/141/142/143: ダッシュボードの横断 read（D/F）と best-effort 合成（I.3/I.4）。

141/142/143＝ドメイン D/F の repository を会社DB に直接 seed して横断 read の絞りを検証（int）。
131＝`get_dashboard()` の1パネル合成が例外でも全体は落とさず当該パネル null（best-effort・I.4）。
production コードは変更しない（実装済みの振る舞いへの純テスト）。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as evals_repo
from app.tenant.evaluations.orm import Evaluation, EvaluationScore
from app.tenant.ideas import repository as ideas_repo
from app.tenant.ideas.orm import Idea, Vote
from app.tenant.profile.orm import User
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from tests.conftest import SEED_COMPANY_CODE
from tests.dashboard.test_api import _db, _login_dash


@pytest.fixture
def tenant():
    """会社DB に quest＋自分＝member・下書き/公開アイデア・投票・下書き/確定評価を seed（横断 read 検証）。"""
    db = _db()
    gid, qid = uuid.uuid4(), uuid.uuid4()
    me = uuid.uuid4()
    draft_i, pub_mine, pub_a, pub_b = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(User(id=me, account_id=uuid.uuid4(), display_name="Me", locale="ja", status="active"))
        quests_repo.create_quest(ts, quest_id=qid, owner_id=me, title="Q", color="#3B82F6", status="recruiting")
        quests_repo.add_member(ts, qid, me, permissions=["owner", "vote"])
        qg_repo.upsert_membership(ts, gid, me, "member")
        ts.add(Idea(id=draft_i, quest_id=qid, author_id=me, title="下書き", body="b", value="v", status="draft"))
        ts.add(Idea(id=pub_mine, quest_id=qid, author_id=me, title="公開自作", body="b", value="v", status="published"))
        ts.add(Idea(id=pub_a, quest_id=qid, author_id=me, title="公開A", body="b", value="v", status="published"))
        ts.add(Idea(id=pub_b, quest_id=qid, author_id=me, title="公開B", body="b", value="v", status="published"))
        ts.flush()
        ts.add(Vote(id=uuid.uuid4(), idea_id=pub_a, user_id=me, type="approve", voted_revision=1))  # A に投票（→未投票から除外）
        ev, _ = evals_repo.upsert_evaluation(ts, pub_a, me, overall_comment=None, status="draft", visibility="party")
        evals_repo.replace_scores(ts, ev.id, [("novelty", 4, None), ("impact", 3, None)])  # 下書き評価 scored=2
        evals_repo.upsert_evaluation(ts, pub_b, me, overall_comment=None, status="submitted", visibility="party")  # 確定＝除外対象
        ts.commit()

    yield SimpleNamespace(db=db, me=me, qid=qid, draft_i=draft_i, pub_mine=pub_mine, pub_a=pub_a, pub_b=pub_b)

    with get_tenant_session(db) as ts:
        idea_ids = [draft_i, pub_mine, pub_a, pub_b]
        ev_ids = [e.id for e in ts.execute(select(Evaluation).where(Evaluation.idea_id.in_(idea_ids))).scalars()]
        if ev_ids:
            ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(ev_ids)))
            ts.execute(Evaluation.__table__.delete().where(Evaluation.id.in_(ev_ids)))
        ts.execute(Vote.__table__.delete().where(Vote.idea_id.in_(idea_ids)))
        ts.execute(Idea.__table__.delete().where(Idea.id.in_(idea_ids)))
        ts.execute(QuestMemberPermission.__table__.delete().where(
            QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
        ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(QuestGroupMember.__table__.delete().where(QuestGroupMember.quest_group_id == gid))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == gid))
        ts.execute(User.__table__.delete().where(User.id == me))
        ts.commit()


def test_i_tc_141_draft_ideas_by_author(tenant):
    """I-TC-141 本人下書きアイデア（全クエスト横断）＝下書きのみ・公開は除外（author=自分・D 横断 read）。"""
    with get_tenant_session(tenant.db) as ts:
        ids = {i.id for i in ideas_repo.list_draft_ideas_by_author(ts, tenant.me)}
    assert ids == {tenant.draft_i}  # 下書きのみ（公開自作/A/B は含まない）


def test_i_tc_142_unvoted_published_ideas(tenant):
    """I-TC-142 参加クエストの published で自票なしのみ（A は投票済み→除外・下書きは published でない→除外）。"""
    with get_tenant_session(tenant.db) as ts:
        ids = {i.id for i in ideas_repo.list_unvoted_published_ideas(ts, tenant.me, [tenant.qid], limit=50)}
    assert tenant.pub_b in ids and tenant.pub_mine in ids  # 未投票の published
    assert tenant.pub_a not in ids                          # 投票済みは除外
    assert tenant.draft_i not in ids                        # 下書きは除外


def test_i_tc_143_draft_evaluations_by_evaluator(tenant):
    """I-TC-143 本人下書き評価（全アイデア横断）＝下書きのみ・進捗 scored/5（確定 submitted は除外）。"""
    with get_tenant_session(tenant.db) as ts:
        evs = evals_repo.list_draft_evaluations_by_evaluator(ts, tenant.me)
        assert len(evs) == 1 and evs[0].idea_id == tenant.pub_a  # 下書きのみ（B の submitted は除外）
        assert len(evals_repo.list_scores(ts, evs[0].id)) == 2   # 進捗 scored=2/5


def test_i_tc_131_partial_failure_best_effort(client, factory, monkeypatch):
    """I-TC-131 1パネルの合成が例外でも全体は落とさず当該パネルのみ null（best-effort・I.4）。"""
    from app.tenant.dashboard import application as dash_app

    acc, _uid = _login_dash(client, factory)  # 会社DB の user ミラーを保証
    with control_session() as s:
        company_id = str(s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().id)

    def _boom(*a, **k):
        raise RuntimeError("panel down")

    monkeypatch.setattr(dash_app.gami_app, "get_rankings", _boom)  # 週間ランキング合成を故障させる
    result = dash_app.get_dashboard({"account_id": str(acc["id"]), "company_id": company_id})
    assert result["weekly_ranking"] is None  # 例外パネルは null（default）
    assert result["hero"] is not None        # 他パネルは正常
    assert "notifications" in result and "drafts" in result  # 全体は例外送出せず返る（200 相当）
