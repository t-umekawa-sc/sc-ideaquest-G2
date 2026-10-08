"""コンセプト AI 評価ワーカー（task_type=concept_evaluate・FR-50・P.5a）の統合テスト。

enqueue→worker→gateway(JSON)→concept_evaluations に AI 評価保存（8観点＋Go/Pivot/Kill）の縦配線を外部 LLM 無し
（fake chat）で検証する。根拠＝doc/テスト/P_コンセプト.md（P-TC-460/461）・設計 §11。共有 dev DB は finally で掃除。
"""
from __future__ import annotations

import json
import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.llm import gateway as gw
from app.infra.llm.gateway import LLMResult
from app.tenant.ai_jobs import application as ai_app
from app.tenant.ai_jobs.orm import AiJob, AiUsageEvent
from app.tenant.concepts import repository as repo
from app.tenant.concepts.orm import Concept, ConceptEvaluation, ConceptEvaluationRevision, ConceptEvaluationScore
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.quests.orm import Quest
from tests.conftest import SEED_COMPANY_CODE

GOOD_JSON = json.dumps({
    "scores": [
        {"aspect": "desirability", "score": 4, "comment": "価値仮説は強い"},
        {"aspect": "feasibility", "score": 3},
        {"aspect": "viability", "score": 3, "comment": "ROI は前提次第"},
        {"aspect": "assumption_strength", "score": 2, "comment": "継続率の検証が不足"},
        {"aspect": "differentiation", "score": 4},
        {"aspect": "novelty", "score": 4},
        {"aspect": "sustainability", "score": 3},
        {"aspect": "ip", "score": 2},
    ],
    "recommendation": "pivot",
    "overall_comment": "望ましさは高いが採算前提が未検証。ターゲットを絞る Pivot を推奨。",
}, ensure_ascii=False)


class _FakeJson:
    def __init__(self, text: str) -> None:
        self.text = text

    def complete(self, messages, *, model, params=None, timeout=None, on_progress=None):
        if on_progress is not None:
            on_progress(5)
        return LLMResult(text=self.text, input_tokens=10, output_tokens=5, provider="openai_compat", model=model, finish_reason="stop")


def _seed_db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _seed_concept(db: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    uid, qid, cid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=f"caieval_{uid.hex[:6]}", locale="ja", status="active"))
        ts.add(Quest(id=qid, owner_id=uid, title="AIコンセプト評価", color="#0D9488", status="evaluating", purpose="テスト"))
        ts.flush()
        ts.add(Concept(id=cid, quest_id=qid, author_id=uid, title="配送統合コンセプト", status="active"))
        ts.commit()
    return uid, qid, cid


def _cleanup(db: str, uid, qid, cid, job_ids: list[uuid.UUID]) -> None:
    with get_tenant_session(db) as ts:
        ev_ids = [e.id for e in ts.query(ConceptEvaluation).filter(ConceptEvaluation.concept_id == cid).all()]
        if ev_ids:
            ts.execute(ConceptEvaluationRevision.__table__.delete().where(ConceptEvaluationRevision.evaluation_id.in_(ev_ids)))
            ts.execute(ConceptEvaluationScore.__table__.delete().where(ConceptEvaluationScore.concept_evaluation_id.in_(ev_ids)))
            ts.execute(ConceptEvaluation.__table__.delete().where(ConceptEvaluation.id.in_(ev_ids)))
        if job_ids:
            ts.execute(AiUsageEvent.__table__.delete().where(AiUsageEvent.job_id.in_(job_ids)))
            ts.execute(AiJob.__table__.delete().where(AiJob.id.in_(job_ids)))
        ts.execute(Notification.__table__.delete().where(Notification.recipient_id == uid))
        ts.execute(Concept.__table__.delete().where(Concept.id == cid))
        ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == uid))
        ts.commit()


def test_p_tc_460_concept_evaluate_worker_creates_ai_evaluation():
    """P-TC-460: concept_evaluate 成功で concept_evaluations に AI 評価（kind='ai'・8観点・recommendation・版1）。"""
    db = _seed_db()
    uid, qid, cid = _seed_concept(db)
    jid = None
    try:
        gw.set_chat_client(_FakeJson(GOOD_JSON))
        jid = ai_app.enqueue_ai_job(db, task_type="concept_evaluate", requested_by_id=uid, input={"concept_id": str(cid)})
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["succeeded"] == 1, stats
        with get_tenant_session(db) as ts:
            ev = ts.query(ConceptEvaluation).filter(ConceptEvaluation.concept_id == cid, ConceptEvaluation.evaluator_kind == "ai").one()
            assert ev.evaluator_id is None and ev.status == "submitted" and ev.visibility == "party"
            assert ev.recommendation == "pivot" and ev.ai_job_id == jid and ev.model
            scores = {s.aspect: s.score for s in ts.query(ConceptEvaluationScore).filter(ConceptEvaluationScore.concept_evaluation_id == ev.id).all()}
            assert scores["desirability"] == 4 and scores["assumption_strength"] == 2 and len(scores) == 8
            revs = ts.query(ConceptEvaluationRevision).filter(ConceptEvaluationRevision.evaluation_id == ev.id).all()
            assert len(revs) == 1 and revs[0].revision == 1 and revs[0].editor_id is None
    finally:
        gw.set_chat_client(gw.FakeChat())
        _cleanup(db, uid, qid, cid, [jid] if jid else [])


def test_p_tc_464_strategy_topk_augments_via_onthefly_embed():
    """P-TC-464: コンセプト（保存埋め込み無）でも本文を評価時 embed→意味的に近い非選択経営資料が top-k 追補（A-2・設計§11）。"""
    from app.infra.llm.embeddings import get_embeddings_client
    from app.tenant.concepts import ai_eval
    from app.tenant.strategy.orm import StrategyDocument
    from app.tenant.tokens import repository as tokens_repo
    from app.tenant.tokens.orm import EntityEmbedding
    db = _seed_db()
    uid, qid, cid = _seed_concept(db)
    close_id = uuid.uuid4()
    try:
        client = get_embeddings_client()  # conftest autouse の FakeEmbeddings
        with get_tenant_session(db) as ts:
            c = ts.get(Concept, cid)
            c.problem = "太陽光 パネル 再エネ 脱炭素"  # 本文を再生可能エネルギークラスタに寄せる（その場 embed で近接）
            # クエスト未選択の経営資料＝top-k でのみ拾える。保存埋め込みは直接 upsert（concept は query を評価時に embed）。
            ts.add(StrategyDocument(id=close_id, title="再エネ推進計画", doc_kind="strategy", status="active",
                                    created_by_id=uid, intent="脱炭素を推進する"))
            ts.flush()
            tokens_repo.upsert_embedding(ts, "strategy_doc", close_id, model=client.model,
                                         vector=client.embed(["再エネ 脱炭素"])[0])
            ts.commit()
        with get_tenant_session(db) as ts:
            msgs = ai_eval.build_messages(ts, cid)
            user = next(m["content"] for m in msgs if m["role"] == "user")
            assert "再エネ推進計画" in user  # concept 本文を評価時 embed→cosine top-k で非選択資料を追補
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(EntityEmbedding.__table__.delete().where(EntityEmbedding.owner_id == close_id))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == close_id))
            ts.commit()
        _cleanup(db, uid, qid, cid, [])


def test_p_tc_461_concept_evaluate_invalid_output_fails():
    """P-TC-461: 推奨欠落など不正出力は job=failed・AI 評価は作られない（graceful）。"""
    db = _seed_db()
    uid, qid, cid = _seed_concept(db)
    jid = None
    try:
        bad = json.dumps({"scores": [{"aspect": "desirability", "score": 4}], "overall_comment": "x"}, ensure_ascii=False)  # recommendation 無し＋中核不足
        gw.set_chat_client(_FakeJson(bad))
        jid = ai_app.enqueue_ai_job(db, task_type="concept_evaluate", requested_by_id=uid, input={"concept_id": str(cid)})
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["failed"] == 1, stats
        with get_tenant_session(db) as ts:
            assert ts.query(ConceptEvaluation).filter(ConceptEvaluation.concept_id == cid, ConceptEvaluation.evaluator_kind == "ai").count() == 0
            assert ts.query(AiJob).filter(AiJob.id == jid).one().error.get("code") == "invalid_output"
    finally:
        gw.set_chat_client(gw.FakeChat())
        _cleanup(db, uid, qid, cid, [jid] if jid else [])
