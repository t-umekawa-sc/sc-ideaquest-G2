"""AI 評価ワーカー（task_type=idea_evaluate・FR-50・F.7）の統合テスト。

enqueue→worker→gateway(JSON)→evaluations に AI 評価保存、の縦配線を外部 LLM 無し（fake chat）で決定的に検証する。
根拠＝doc/テスト/F_評価.md（F-TC-215/216）・API設計 F.7・設計 §3/§4。共有 dev DB を汚さぬよう finally で掃除。
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
from app.tenant.evaluations.orm import Evaluation, EvaluationRevision, EvaluationScore
from app.tenant.ideas.orm import Idea
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from app.tenant.quests.orm import Quest
from tests.conftest import SEED_COMPANY_CODE

GOOD_JSON = json.dumps({
    "scores": [
        {"aspect": "novelty", "score": 4, "comment": "既存にない統合発想"},
        {"aspect": "impact", "score": 5, "comment": ""},
        {"aspect": "feasibility", "score": 3},
        {"aspect": "fit", "score": 4, "comment": "方針と整合"},
        {"aspect": "cost", "score": 5},
    ],
    "overall_comment": "コスト効果が高く、全体として有望。",
}, ensure_ascii=False)


class _FakeJson:
    """固定テキストを返す chat client（JSON や非JSON をテストから差し込む）。"""

    def __init__(self, text: str) -> None:
        self.text = text

    def complete(self, messages, *, model, params=None, timeout=None, on_progress=None):
        if on_progress is not None:
            on_progress(5)
        return LLMResult(text=self.text, input_tokens=10, output_tokens=5, provider="openai_compat", model=model, finish_reason="stop")


def _seed_db() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _seed_idea(db: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """user / quest / published idea を seed＝(user_id, quest_id, idea_id)。"""
    uid, qid, iid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=f"aieval_{uid.hex[:6]}", locale="ja", status="active"))
        ts.add(Quest(id=qid, owner_id=uid, title="AI評価クエスト", color="#0D9488", status="recruiting", purpose="テスト目的"))
        ts.flush()  # quest/user を idea より先に INSERT（FK 順序を保証）
        ts.add(Idea(id=iid, quest_id=qid, author_id=uid, title="AI評価アイデア", body="本文", value="価値", status="published"))
        ts.commit()
    return uid, qid, iid


def _cleanup(db: str, user_id: uuid.UUID, quest_id: uuid.UUID, idea_id: uuid.UUID, job_ids: list[uuid.UUID]) -> None:
    with get_tenant_session(db) as ts:
        ev_ids = [e.id for e in ts.query(Evaluation).filter(Evaluation.idea_id == idea_id).all()]
        if ev_ids:
            ts.execute(EvaluationRevision.__table__.delete().where(EvaluationRevision.evaluation_id.in_(ev_ids)))
            ts.execute(EvaluationScore.__table__.delete().where(EvaluationScore.evaluation_id.in_(ev_ids)))
            ts.execute(Evaluation.__table__.delete().where(Evaluation.id.in_(ev_ids)))
        if job_ids:
            ts.execute(AiUsageEvent.__table__.delete().where(AiUsageEvent.job_id.in_(job_ids)))
            ts.execute(AiJob.__table__.delete().where(AiJob.id.in_(job_ids)))
        ts.execute(Notification.__table__.delete().where(Notification.recipient_id == user_id))
        ts.execute(Idea.__table__.delete().where(Idea.id == idea_id))
        ts.execute(Quest.__table__.delete().where(Quest.id == quest_id))
        ts.execute(User.__table__.delete().where(User.id == user_id))
        ts.commit()


def test_f_tc_215_idea_evaluate_worker_creates_ai_evaluation():
    """F-TC-215: idea_evaluate ジョブ成功で evaluations に AI 評価（kind='ai'・submitted・party・5観点・版1）が入る。"""
    db = _seed_db()
    uid, qid, iid = _seed_idea(db)
    jid = None
    try:
        gw.set_chat_client(_FakeJson(GOOD_JSON))
        jid = ai_app.enqueue_ai_job(db, task_type="idea_evaluate", requested_by_id=uid,
                                    input={"idea_id": str(iid)}, ref_idea_id=iid)
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["succeeded"] == 1, stats
        with get_tenant_session(db) as ts:
            ev = ts.query(Evaluation).filter(Evaluation.idea_id == iid, Evaluation.evaluator_kind == "ai").one()
            assert ev.evaluator_id is None and ev.status == "submitted" and ev.visibility == "party"
            assert ev.ai_job_id == jid and ev.model and ev.overall_comment.startswith("コスト効果")
            scores = {s.aspect: s.score for s in ts.query(EvaluationScore).filter(EvaluationScore.evaluation_id == ev.id).all()}
            assert scores == {"novelty": 4, "impact": 5, "feasibility": 3, "fit": 4, "cost": 5}
            revs = ts.query(EvaluationRevision).filter(EvaluationRevision.evaluation_id == ev.id).all()
            assert len(revs) == 1 and revs[0].revision == 1 and revs[0].editor_id is None  # 自動生成＝editor NULL
    finally:
        gw.set_chat_client(gw.FakeChat())
        _cleanup(db, uid, qid, iid, [jid] if jid else [])


def test_f_tc_217_publish_auto_enqueues_idea_evaluate(monkeypatch):
    """F-TC-217: 公開経路のヘルパーが idea_evaluate ジョブを自動投入する（F.7.1・opt-in フラグ ON 時・graceful）。"""
    from app.core.config import get_settings
    from app.tenant.ideas.application import _enqueue_idea_ai_evaluation
    monkeypatch.setenv("LLM_AUTO_EVALUATE_ON_PUBLISH", "true")
    get_settings.cache_clear()  # env 反映（conftest が前後で cache_clear するのでリークしない）
    db = _seed_db()
    uid, qid, iid = _seed_idea(db)
    job_ids: list[uuid.UUID] = []
    try:
        _enqueue_idea_ai_evaluation(db, iid, uid)
        with get_tenant_session(db) as ts:
            jobs = ts.query(AiJob).filter(AiJob.task_type == "idea_evaluate", AiJob.ref_idea_id == iid).all()
            job_ids = [j.id for j in jobs]
            assert len(jobs) == 1 and jobs[0].status == "queued"
            assert (jobs[0].input or {}).get("idea_id") == str(iid)
    finally:
        _cleanup(db, uid, qid, iid, job_ids)


def test_f_tc_216_idea_evaluate_invalid_output_fails_job_no_evaluation():
    """F-TC-216: 出力が不正(JSONでない)なら job=failed・AI 評価は作られない（人間評価のみで進行・graceful）。"""
    db = _seed_db()
    uid, qid, iid = _seed_idea(db)
    jid = None
    try:
        gw.set_chat_client(_FakeJson("これはJSONではありません"))
        jid = ai_app.enqueue_ai_job(db, task_type="idea_evaluate", requested_by_id=uid, input={"idea_id": str(iid)}, ref_idea_id=iid)
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["failed"] == 1, stats
        with get_tenant_session(db) as ts:
            assert ts.query(Evaluation).filter(Evaluation.idea_id == iid, Evaluation.evaluator_kind == "ai").count() == 0
            job = ts.query(AiJob).filter(AiJob.id == jid).one()
            assert job.status == "failed" and job.error and job.error.get("code") == "invalid_output"
    finally:
        gw.set_chat_client(gw.FakeChat())
        _cleanup(db, uid, qid, iid, [jid] if jid else [])
