"""P-TC-001〜015: concepts repository の永続化プリミティブ（§5.38-5.46）。

対象＝`app/tenant/concepts/repository.py`。前提（クエスト/アイデア/ユーザー）は ORM で直接 seed。
repository 関数は呼び出し側 Tx に相乗するため、テストが commit し別セッションで再取得して検証する。
"""
from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts import repository as repo
from app.tenant.concepts.orm import (
    Assumption,
    AssumptionValidation,
    Concept,
    ConceptAssumptionLink,
    ConceptChatScope,
    ConceptEvaluation,
    ConceptEvaluationScore,
    ConceptSourceIdea,
    ConceptVote,
)
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests.orm import Quest
from tests.conftest import SEED_COMPANY_CODE


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
    group_id, quest_id = uuid.uuid4(), uuid.uuid4()
    idea1, idea2 = uuid.uuid4(), uuid.uuid4()
    u1, u2 = uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        for uid, name in ((u1, "U1"), (u2, "U2")):
            ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=name, locale="ja", status="active"))
        ts.flush()
        ts.add(Quest(id=quest_id, owner_id=u1, title="Q", color="#3B82F6", status="evaluating"))
        ts.flush()
        for iid in (idea1, idea2):
            ts.add(Idea(id=iid, quest_id=quest_id, author_id=u1, title="I", body="b", value="v", status="published"))
        ts.commit()
    yield SimpleNamespace(
        db_identifier=db_identifier, quest_id=quest_id, idea1=idea1, idea2=idea2, u1=u1, u2=u2,
    )
    with get_tenant_session(db_identifier) as ts:
        cids = [c.id for c in ts.query(Concept).filter(Concept.quest_id == quest_id).all()]
        aids = [a.id for a in ts.query(Assumption).filter(Assumption.quest_id == quest_id).all()]
        eids = [e.id for e in ts.query(ConceptEvaluation).filter(ConceptEvaluation.concept_id.in_(cids or [uuid.uuid4()])).all()]
        if eids:
            ts.execute(ConceptEvaluationScore.__table__.delete().where(ConceptEvaluationScore.concept_evaluation_id.in_(eids)))
        ts.execute(ConceptEvaluation.__table__.delete().where(ConceptEvaluation.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptVote.__table__.delete().where(ConceptVote.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptChatScope.__table__.delete().where(ConceptChatScope.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(ConceptAssumptionLink.__table__.delete().where(ConceptAssumptionLink.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(AssumptionValidation.__table__.delete().where(AssumptionValidation.assumption_id.in_(aids or [uuid.uuid4()])))
        ts.execute(ConceptSourceIdea.__table__.delete().where(ConceptSourceIdea.concept_id.in_(cids or [uuid.uuid4()])))
        ts.execute(Assumption.__table__.delete().where(Assumption.quest_id == quest_id))
        ts.execute(Concept.__table__.delete().where(Concept.quest_id == quest_id))
        ts.execute(Idea.__table__.delete().where(Idea.quest_id == quest_id))
        ts.execute(Quest.__table__.delete().where(Quest.id == quest_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id.in_([u1, u2])))
        ts.commit()


def _new_concept(ts, env, **kw):
    return repo.create_concept(ts, quest_id=env.quest_id, author_id=env.u1, title=kw.pop("title", "C"), **kw)


def test_p_tc_001_create_concept_defaults(env):
    """P-TC-001: 作成は行1・既定 status=draft/decision=undecided/is_selected=false・viability 反映。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env, viability={"roi": "12%"})
        ts.commit()
        cid = c.id
    with get_tenant_session(env.db_identifier) as ts:
        got = repo.get_concept(ts, cid)
        assert got is not None
        assert got.status == "draft" and got.decision == "undecided" and got.is_selected is False
        assert got.viability == {"roi": "12%"} and got.current_revision == 1


def test_p_tc_002_set_source_ideas_replace(env):
    """P-TC-002: 由来アイデアは置換セットで全置換（重複畳み・最終1件）。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        repo.set_source_ideas(ts, c.id, [env.idea1, env.idea2, env.idea1])
        ts.commit()
        cid = c.id
    with get_tenant_session(env.db_identifier) as ts:
        assert set(repo.list_source_idea_ids(ts, cid)) == {env.idea1, env.idea2}
    with get_tenant_session(env.db_identifier) as ts:
        repo.set_source_ideas(ts, cid, [env.idea2])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.list_source_idea_ids(ts, cid) == [env.idea2]


def test_p_tc_003_create_assumption_default_inconclusive(env):
    """P-TC-003: 前提作成は current_verdict=inconclusive（既定）。"""
    with get_tenant_session(env.db_identifier) as ts:
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="市場がある", created_by_id=env.u1)
        ts.commit()
        aid = a.id
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_assumption(ts, aid).current_verdict == "inconclusive"


def test_p_tc_004_add_validation_recompute_latest(env):
    """P-TC-004: 検証追記で current_verdict=最新イベント・履歴は実施日降順で保持。"""
    with get_tenant_session(env.db_identifier) as ts:
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="s", created_by_id=env.u1)
        repo.add_validation(ts, assumption_id=a.id, method="interview", verdict="supported",
                            validated_on=date(2026, 1, 10), scale="n=5")
        repo.add_validation(ts, assumption_id=a.id, method="pilot", verdict="refuted",
                            validated_on=date(2026, 3, 20), scale="n=50")
        ts.commit()
        aid = a.id
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_assumption(ts, aid).current_verdict == "refuted"
        hist = repo.list_validations(ts, aid)
        assert [h.verdict for h in hist] == ["refuted", "supported"]  # 実施日降順（最新先頭）


def test_p_tc_005_verdict_follows_validated_on_not_insertion(env):
    """P-TC-005: 現在判定は実施日順で決まる＝後から古い日付を足しても最新日の判定が維持。"""
    with get_tenant_session(env.db_identifier) as ts:
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="s", created_by_id=env.u1)
        repo.add_validation(ts, assumption_id=a.id, method="m", verdict="supported", validated_on=date(2026, 5, 1))
        # 後から「古い実施日」の反証を追記しても、最新実施日（5/1 supported）が維持される。
        repo.add_validation(ts, assumption_id=a.id, method="m2", verdict="refuted", validated_on=date(2026, 2, 1))
        ts.commit()
        aid = a.id
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_assumption(ts, aid).current_verdict == "supported"


def test_p_tc_006_link_assumption_with_criticality(env):
    """P-TC-006: リンクは criticality を持ち is_stale=false 既定。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="s", created_by_id=env.u1)
        repo.link_assumption(ts, concept_id=c.id, assumption_id=a.id, criticality="critical", created_by_id=env.u1)
        ts.commit()
        cid, aid = c.id, a.id
    with get_tenant_session(env.db_identifier) as ts:
        link = repo.get_link(ts, cid, aid)
        assert link.criticality == "critical" and link.is_stale is False


def test_p_tc_007_refute_marks_all_links_stale(env):
    """P-TC-007: 共有前提の反証波及＝リンク先の全リンクが is_stale=true・対象コンセプトを返す。"""
    with get_tenant_session(env.db_identifier) as ts:
        c1, c2 = _new_concept(ts, env, title="C1"), _new_concept(ts, env, title="C2")
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="s", created_by_id=env.u1)
        repo.link_assumption(ts, concept_id=c1.id, assumption_id=a.id)
        repo.link_assumption(ts, concept_id=c2.id, assumption_id=a.id)
        repo.add_validation(ts, assumption_id=a.id, method="m", verdict="refuted", validated_on=date(2026, 4, 1))
        affected = repo.mark_links_stale_for_assumption(ts, a.id)
        ts.commit()
        cid1, cid2, aid = c1.id, c2.id, a.id
    assert set(affected) == {cid1, cid2}
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_link(ts, cid1, aid).is_stale is True
        assert repo.get_link(ts, cid2, aid).is_stale is True


def test_p_tc_008_set_link_stale_clear(env):
    """P-TC-008: stale 解除（再評価の記録）。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="s", created_by_id=env.u1)
        link = repo.link_assumption(ts, concept_id=c.id, assumption_id=a.id)
        link.is_stale = True
        ts.flush()
        repo.set_link_criticality_stale(ts, link, is_stale=False)
        ts.commit()
        cid, aid = c.id, a.id
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_link(ts, cid, aid).is_stale is False


def test_p_tc_009_delete_assumption_blocked_when_linked(env):
    """P-TC-009: 前提削除はリンク有りで不可（False）・未リンクは削除（True）。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        a_linked = repo.create_assumption(ts, quest_id=env.quest_id, statement="linked", created_by_id=env.u1)
        a_free = repo.create_assumption(ts, quest_id=env.quest_id, statement="free", created_by_id=env.u1)
        repo.link_assumption(ts, concept_id=c.id, assumption_id=a_linked.id)
        ts.commit()
        a_linked_id, a_free_id = a_linked.id, a_free.id
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.delete_assumption(ts, a_linked_id) is False
        assert repo.delete_assumption(ts, a_free_id) is True
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_assumption(ts, a_free_id) is None
        assert repo.get_assumption(ts, a_linked_id) is not None


def test_p_tc_010_upsert_evaluation(env):
    """P-TC-010: 評価 upsert（作成→更新・1人1評価）。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        ev, created = repo.upsert_evaluation(ts, c.id, env.u2, overall_comment=None, recommendation=None,
                                             status="draft", visibility="party")
        assert created is True
        ev2, created2 = repo.upsert_evaluation(ts, c.id, env.u2, overall_comment="ok", recommendation="go",
                                               status="submitted", visibility="limited")
        assert created2 is False and ev2.id == ev.id
        ts.commit()
        cid = c.id
    with get_tenant_session(env.db_identifier) as ts:
        got = repo.get_evaluation(ts, cid, env.u2)
        assert got.status == "submitted" and got.recommendation == "go" and got.visibility == "limited"


def test_p_tc_011_replace_scores(env):
    """P-TC-011: 観点スコアの置換セット（中核5→8観点で全置換・UNIQUE）。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        ev, _ = repo.upsert_evaluation(ts, c.id, env.u2, overall_comment=None, recommendation=None,
                                       status="draft", visibility="party")
        repo.replace_scores(ts, ev.id, [(a, 3, None) for a in repo.CORE_ASPECTS])
        ts.commit()
        eid = ev.id
    with get_tenant_session(env.db_identifier) as ts:
        rows = repo.get_scores_for_evaluations(ts, [eid])[eid]
        assert {r.aspect for r in rows} == set(repo.CORE_ASPECTS)
    with get_tenant_session(env.db_identifier) as ts:
        repo.replace_scores(ts, eid, [(a, 5, "c") for a in repo.ALL_ASPECTS])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        rows = repo.get_scores_for_evaluations(ts, [eid])[eid]
        assert {r.aspect for r in rows} == set(repo.ALL_ASPECTS) and all(r.score == 5 for r in rows)


def test_p_tc_012_aggregate_scores(env):
    """P-TC-012: 集計＝観点別平均・中核5の総合平均・推奨内訳・評価者数。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        e1, _ = repo.upsert_evaluation(ts, c.id, env.u1, overall_comment="a", recommendation="go",
                                       status="submitted", visibility="party")
        repo.replace_scores(ts, e1.id, [(a, 4, None) for a in repo.CORE_ASPECTS])
        e2, _ = repo.upsert_evaluation(ts, c.id, env.u2, overall_comment="b", recommendation="pivot",
                                       status="submitted", visibility="party")
        repo.replace_scores(ts, e2.id, [(a, 2, None) for a in repo.CORE_ASPECTS])
        ts.commit()
        cid = c.id
    with get_tenant_session(env.db_identifier) as ts:
        agg = repo.aggregate_scores(ts, cid)
        assert agg["evaluator_count"] == 2
        assert agg["aspects"]["desirability"] == 3.0  # (4+2)/2
        assert agg["overall_avg"] == 3.0
        assert agg["recommendations"] == {"go": 1, "pivot": 1}


def test_p_tc_013_vote_upsert_and_delete(env):
    """P-TC-013: 投票（賛成/反対・1人1票・切替/取消）。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        _, created = repo.upsert_vote(ts, c.id, env.u2, type="approve")
        assert created is True
        _, created2 = repo.upsert_vote(ts, c.id, env.u2, type="oppose")
        assert created2 is False
        ts.commit()
        cid = c.id
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_vote(ts, cid, env.u2).type == "oppose"
        assert repo.count_votes(ts, cid) == {"oppose": 1}
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.delete_vote(ts, cid, env.u2) is True
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_vote(ts, cid, env.u2) is None


def test_p_tc_014_chat_scopes(env):
    """P-TC-014: チャットスコープ（overall/group/assumption）・前提スレッドは assumption_id 紐付き。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        a = repo.create_assumption(ts, quest_id=env.quest_id, statement="s", created_by_id=env.u1)
        repo.create_chat_scope(ts, concept_id=c.id, kind="overall", position=0)
        repo.create_chat_scope(ts, concept_id=c.id, kind="group", label="価値・対象・競合", position=1)
        repo.create_chat_scope(ts, concept_id=c.id, kind="assumption", assumption_id=a.id, position=2)
        ts.commit()
        cid, aid = c.id, a.id
    with get_tenant_session(env.db_identifier) as ts:
        scopes = repo.list_chat_scopes(ts, cid)
        assert [s.kind for s in scopes] == ["overall", "group", "assumption"]
        assert scopes[2].assumption_id == aid


def test_p_tc_015_soft_delete_concept(env):
    """P-TC-015: 論理削除＝deleted_at セット・取得/一覧から除外・行は残る。"""
    with get_tenant_session(env.db_identifier) as ts:
        c = _new_concept(ts, env)
        ts.commit()
        cid = c.id
    with get_tenant_session(env.db_identifier) as ts:
        repo.soft_delete_concept(ts, repo.get_concept(ts, cid), deleted_by_id=env.u1)
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert repo.get_concept(ts, cid) is None  # 既定は非削除のみ
        assert repo.get_concept(ts, cid, include_deleted=True) is not None
        assert cid not in [c.id for c in repo.list_concepts_for_quest(ts, env.quest_id)]
