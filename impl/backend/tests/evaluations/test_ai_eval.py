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


def test_f_tc_220_build_messages_includes_rag_context():
    """F-TC-220: build_messages に関連情報（FR-41・反証優先）と経営資料（FR-44）が RAG として注入される（設計 §3）。"""
    from app.tenant.evaluations import ai_eval
    from app.tenant.info.orm import InfoItem, InfoLink
    from app.tenant.strategy.orm import QuestStrategyDocument, StrategyDocument
    db = _seed_db()
    uid, qid, iid = _seed_idea(db)
    info_id, doc_id = uuid.uuid4(), uuid.uuid4()
    try:
        with get_tenant_session(db) as ts:
            ts.add(InfoItem(id=info_id, title="競合値下げ情報", status="curated", created_by_id=uid, summary="A社が10%値下げ", impact_class="threat"))
            ts.add(StrategyDocument(id=doc_id, title="中期物流戦略", doc_kind="strategy", status="active", created_by_id=uid, intent="物流効率化を推進", focus_areas=["物流", "コスト"]))
            ts.flush()
            ts.add(InfoLink(id=uuid.uuid4(), info_item_id=info_id, target_type="ideas", target_id=iid, kind="refuting", origin="manual", disposition="pending"))
            ts.add(QuestStrategyDocument(id=uuid.uuid4(), quest_id=qid, strategy_document_id=doc_id))
            ts.commit()
        with get_tenant_session(db) as ts:
            msgs = ai_eval.build_messages(ts, iid)
            user = next(m["content"] for m in msgs if m["role"] == "user")
            assert "競合値下げ情報" in user and "反証" in user          # 関連情報（反証ラベル優先）
            assert "中期物流戦略" in user and "物流効率化を推進" in user  # 経営資料（意図）
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(InfoLink.__table__.delete().where(InfoLink.info_item_id == info_id))
            ts.execute(InfoItem.__table__.delete().where(InfoItem.id == info_id))
            ts.execute(QuestStrategyDocument.__table__.delete().where(QuestStrategyDocument.strategy_document_id == doc_id))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id == doc_id))
            ts.commit()
        _cleanup(db, uid, qid, iid, [])


def test_f_tc_222_strategy_topk_augments_unselected_docs():
    """F-TC-222: クエスト未選択でも成果物に意味的に近い経営資料が top-k 追補され、無関係資料は入らない（A-2・設計§3）。"""
    from app.infra.llm.embeddings import get_embeddings_client
    from app.tenant.evaluations import ai_eval
    from app.tenant.strategy.orm import StrategyDocument
    from app.tenant.tokens import repository as tokens_repo
    from app.tenant.tokens.orm import EntityEmbedding
    db = _seed_db()
    uid, qid, iid = _seed_idea(db)
    close_id, far_id = uuid.uuid4(), uuid.uuid4()
    try:
        client = get_embeddings_client()  # conftest autouse の FakeEmbeddings（同義クラスタで意味近接を決定的に再現）
        model = client.model
        with get_tenant_session(db) as ts:
            # どちらもクエスト未選択（QuestStrategyDocument なし）＝top-k でのみ拾える。
            ts.add(StrategyDocument(id=close_id, title="再エネ推進計画", doc_kind="strategy", status="active",
                                    created_by_id=uid, intent="脱炭素を推進する"))
            ts.add(StrategyDocument(id=far_id, title="人材育成方針", doc_kind="strategy", status="active",
                                    created_by_id=uid, intent="組織の人材育成"))
            ts.flush()
            # idea クエリベクトル＝再生可能エネルギークラスタ／close=同クラスタ(cosine 1.0)・far=別クラスタ(cosine 0.0)。
            tokens_repo.upsert_embedding(ts, "idea", iid, model=model, vector=client.embed(["太陽光 パネル"])[0])
            tokens_repo.upsert_embedding(ts, "strategy_doc", close_id, model=model, vector=client.embed(["再エネ 脱炭素"])[0])
            tokens_repo.upsert_embedding(ts, "strategy_doc", far_id, model=model, vector=client.embed(["人材 育成 研修"])[0])
            ts.commit()
        with get_tenant_session(db) as ts:
            msgs = ai_eval.build_messages(ts, iid)
            user = next(m["content"] for m in msgs if m["role"] == "user")
            assert "再エネ推進計画" in user          # 意味的に近い非選択資料＝top-k 追補される
            assert "人材育成方針" not in user        # min_cosine 未満＝追補されない
    finally:
        with get_tenant_session(db) as ts:
            ts.execute(EntityEmbedding.__table__.delete().where(
                EntityEmbedding.owner_id.in_([iid, close_id, far_id])))
            ts.execute(StrategyDocument.__table__.delete().where(StrategyDocument.id.in_([close_id, far_id])))
            ts.commit()
        _cleanup(db, uid, qid, iid, [])


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
            # システム起票＝SC-04 個人一覧に出さない（created_by_id=NULL・created_program で識別・§6/§2.1）。
            assert jobs[0].created_by_id is None and jobs[0].created_program == "auto_evaluate"
    finally:
        _cleanup(db, uid, qid, iid, job_ids)


def test_f_tc_221_failure_notifies_evaluator_holders():
    """F-TC-221: idea_evaluate 失敗は依頼者に加え評価者権限保持者へも ai_task_failed 通知（FR-50・§6-5）。"""
    from app.tenant.notifications.orm import Notification
    from app.tenant.quests import repository as quests_repo
    from app.tenant.quests.orm import QuestMember, QuestMemberPermission
    db = _seed_db()
    uid, qid, iid = _seed_idea(db)
    evaluator = uuid.uuid4()
    jid = None
    try:
        with get_tenant_session(db) as ts:
            ts.add(User(id=evaluator, account_id=uuid.uuid4(), display_name="ev", locale="ja", status="active"))
            ts.flush()
            quests_repo.add_member(ts, qid, uid, permissions=["owner"])
            quests_repo.add_member(ts, qid, evaluator, permissions=["evaluator"])
            ts.commit()
        gw.set_chat_client(_FakeJson("not json at all"))
        jid = ai_app.enqueue_ai_job(db, task_type="idea_evaluate", requested_by_id=uid, input={"idea_id": str(iid)}, ref_idea_id=iid)
        assert ai_app.process_ai_jobs_once(db)["failed"] == 1
        with get_tenant_session(db) as ts:
            n = ts.query(Notification).filter(Notification.recipient_id == evaluator, Notification.type == "ai_task_failed").count()
            assert n == 1  # 評価者権限保持者（非依頼者）にも失敗通知
    finally:
        gw.set_chat_client(gw.FakeChat())
        with get_tenant_session(db) as ts:
            mids = [m.id for m in ts.query(QuestMember).filter(QuestMember.quest_id == qid).all()]
            if mids:
                ts.execute(QuestMemberPermission.__table__.delete().where(QuestMemberPermission.quest_member_id.in_(mids)))
                ts.execute(QuestMember.__table__.delete().where(QuestMember.id.in_(mids)))
            ts.execute(Notification.__table__.delete().where(Notification.recipient_id.in_([evaluator, uid])))
            ts.execute(User.__table__.delete().where(User.id == evaluator))
            ts.commit()
        _cleanup(db, uid, qid, iid, [jid] if jid else [])


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
