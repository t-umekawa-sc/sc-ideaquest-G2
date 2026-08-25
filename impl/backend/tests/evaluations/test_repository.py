"""F-TC-001〜004: evaluations repository の永続化プリミティブ（§5.21/§5.22）。

対象＝`app/tenant/evaluations/repository.py`。前提（クエスト/アイデア/ユーザー）は ORM で直接 seed。
repository 関数は呼び出し側 Tx に相乗するため、テストが commit し別セッションで再取得して検証する。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.evaluations import repository as repo
from app.tenant.evaluations.orm import Evaluation, EvaluationScore
from app.tenant.ideas.orm import Idea
from app.tenant.profile.orm import User
from app.tenant.quest_group.orm import QuestGroup
from app.tenant.quests.orm import Quest
from tests.conftest import SEED_COMPANY_CODE


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
    group_id, quest_id, idea_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    e1, e2, e3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroup(id=group_id, quest_group_code=f"QG-{uuid.uuid4().hex[:6].upper()}", name="G"))
        for uid, name in ((e1, "E1"), (e2, "E2"), (e3, "E3")):
            ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=name, locale="ja", status="active"))
        ts.flush()
        ts.add(Quest(id=quest_id, quest_group_id=group_id, owner_id=e1, title="Q", color="#3B82F6", status="evaluating"))
        ts.flush()  # Idea の FK(quest_id) 解決のため先に Quest を flush
        ts.add(Idea(id=idea_id, quest_id=quest_id, author_id=e1, title="I", body="b", value="v", status="published"))
        ts.commit()
    yield SimpleNamespace(db_identifier=db_identifier, quest_id=quest_id, idea_id=idea_id, e1=e1, e2=e2, e3=e3)
    with get_tenant_session(db_identifier) as ts:
        eval_ids = [e.id for e in repo.list_evaluations_for_idea(ts, idea_id)]
        if eval_ids:
            ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(eval_ids)))
        ts.execute(Evaluation.__table__.delete().where(Evaluation.idea_id == idea_id))
        ts.execute(Idea.__table__.delete().where(Idea.id == idea_id))
        ts.execute(Quest.__table__.delete().where(Quest.id == quest_id))
        ts.execute(QuestGroup.__table__.delete().where(QuestGroup.id == group_id))
        ts.execute(User.__table__.delete().where(User.id.in_([e1, e2, e3])))
        ts.commit()


def test_f_tc_001_upsert_evaluation(env):
    """F-TC-001: upsert（作成→更新）は行1つ・status/overall を更新。"""
    with get_tenant_session(env.db_identifier) as ts:
        ev, created = repo.upsert_evaluation(ts, env.idea_id, env.e1, overall_comment=None, status="draft", visibility="party")
        assert created is True
        ev2, created2 = repo.upsert_evaluation(ts, env.idea_id, env.e1, overall_comment="ok", status="submitted", visibility="limited")
        assert created2 is False and ev2.id == ev.id
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        got = repo.get_evaluation(ts, env.idea_id, env.e1)
        assert got.status == "submitted" and got.overall_comment == "ok" and got.visibility == "limited"


def test_f_tc_002_replace_scores(env):
    """F-TC-002: 観点スコアの置換セット（各観点1行・後の値で全置換）。"""
    with get_tenant_session(env.db_identifier) as ts:
        ev, _ = repo.upsert_evaluation(ts, env.idea_id, env.e1, overall_comment=None, status="draft", visibility="party")
        repo.replace_scores(ts, ev.id, [(a, 3, None) for a in repo.ASPECTS])
        repo.replace_scores(ts, ev.id, [(a, 5, "c") for a in repo.ASPECTS])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        ev = repo.get_evaluation(ts, env.idea_id, env.e1)
        scores = repo.list_scores(ts, ev.id)
        assert len(scores) == 5 and all(s.score == 5 for s in scores)


def test_f_tc_003_list_evaluations_status(env):
    """F-TC-003: アイデアの評価一覧（status で絞る）。"""
    with get_tenant_session(env.db_identifier) as ts:
        s1, _ = repo.upsert_evaluation(ts, env.idea_id, env.e1, overall_comment="a", status="submitted", visibility="party")
        repo.upsert_evaluation(ts, env.idea_id, env.e2, overall_comment=None, status="draft", visibility="party")
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        assert len(repo.list_evaluations_for_idea(ts, env.idea_id)) == 2
        submitted = repo.list_evaluations_for_idea(ts, env.idea_id, status="submitted")
        assert [e.evaluator_id for e in submitted] == [env.e1]


def test_f_tc_004_aggregate_scores(env):
    """F-TC-004: 集計＝2名の submitted スコアの観点別平均が一致（バッチ取得）。"""
    with get_tenant_session(env.db_identifier) as ts:
        a, _ = repo.upsert_evaluation(ts, env.idea_id, env.e1, overall_comment="a", status="submitted", visibility="party")
        repo.replace_scores(ts, a.id, [(x, 4, None) for x in repo.ASPECTS])
        b, _ = repo.upsert_evaluation(ts, env.idea_id, env.e2, overall_comment="b", status="submitted", visibility="party")
        repo.replace_scores(ts, b.id, [(x, 2, None) for x in repo.ASPECTS])
        ts.commit()
    with get_tenant_session(env.db_identifier) as ts:
        subs = repo.list_evaluations_for_idea(ts, env.idea_id, status="submitted")
        by = repo.get_scores_for_evaluations(ts, [e.id for e in subs])
        novelty = [s.score for e in subs for s in by[e.id] if s.aspect == "novelty"]
        assert sum(novelty) / len(novelty) == 3.0  # (4+2)/2
