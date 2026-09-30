"""AIジョブ基盤の状態機械・enqueue・課金メータリング（int・FR-45・doc/テスト/S_AIジョブ.md §1/§3/§4）。

FakeChat（conftest autouse）で外部未接続・決定的。共有 dev DB を汚さぬよう投入した行を finally で掃除する。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.ai_jobs import application as ai_app
from app.tenant.ai_jobs import repository as ai_repo
from app.tenant.ai_jobs.orm import AiJob, AiUsageEvent
from app.tenant.notifications.orm import Notification
from app.tenant.profile.orm import User
from tests.conftest import SEED_COMPANY_CODE


def _seed_db() -> str:
    from app.control_plane.auth.orm import Company
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _mk_user(db: str) -> uuid.UUID:
    uid = uuid.uuid4()
    with get_tenant_session(db) as ts:
        ts.add(User(id=uid, account_id=uuid.uuid4(), display_name=f"aijob_{uid.hex[:6]}", locale="ja", status="active"))
        ts.commit()
    return uid


def _cleanup(db: str, user_id: uuid.UUID, job_ids: list[uuid.UUID]) -> None:
    with get_tenant_session(db) as ts:
        if job_ids:
            ts.execute(AiUsageEvent.__table__.delete().where(AiUsageEvent.job_id.in_(job_ids)))
            ts.execute(AiJob.__table__.delete().where(AiJob.id.in_(job_ids)))
        # 通知は recipient_id(=user) を FK 参照するため user より先に消す。
        ts.execute(Notification.__table__.delete().where(Notification.recipient_id == user_id))
        ts.execute(User.__table__.delete().where(User.id == user_id))
        ts.commit()


def test_s_tc_101_enqueue_creates_queued():
    """S-TC-101: enqueue でジョブが queued 生成される。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "競合A社が値下げした。詳細は続報。"})
        with get_tenant_session(db) as ts:
            job = ai_repo.get(ts, jid)
            assert job.status == "queued" and job.requested_by_id == user_id
            assert job.task_type == "info_summarize"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_103_process_success_result_and_usage():
    """S-TC-103/121: worker 取り出し→running→succeeded＋result＋usage 記録（FakeChat）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "競合A社が値下げした。詳細は続報。"})
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["succeeded"] == 1, stats
        with get_tenant_session(db) as ts:
            job = ai_repo.get(ts, jid)
            assert job.status == "succeeded"
            assert job.result and job.result["text"].startswith("[要約]")
            assert job.provider == "openai_compat" and job.model  # 物理を監査記録
            assert job.input_tokens is not None and job.output_tokens and job.output_tokens > 0
            assert job.started_at and job.finished_at
            # 課金基礎＝ai_usage_events に1行（free＝cost 0・トークンは記録）
            ev = ts.query(AiUsageEvent).filter_by(job_id=jid).one()
            assert ev.billing == "free" and ev.cost_micros == 0
            assert ev.model_key == "qwen3-light" and ev.output_tokens > 0
            assert ev.rate_snapshot["pricing_version"] == "phase1-free"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_105_permanent_fail_on_bad_input():
    """S-TC-105: 入力不正（text 無し）は即 failed（リトライしない）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id, input={})
        ai_app.process_ai_jobs_once(db)
        with get_tenant_session(db) as ts:
            job = ai_repo.get(ts, jid)
            assert job.status == "failed" and job.error["code"] == "invalid_input"
            assert job.attempts == 0  # 恒久失敗はリトライしない
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_117_cancel_queued():
    """S-TC-117: cancel_requested の queued は process で即 canceled（取り出さない）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "x"})
        with get_tenant_session(db) as ts:
            ai_repo.get(ts, jid).cancel_requested = True
            ts.commit()
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["canceled"] == 1 and stats["succeeded"] == 0
        with get_tenant_session(db) as ts:
            assert ai_repo.get(ts, jid).status == "canceled"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_126_notify_done_on_success():
    """S-TC-126: 完了で ai_task_done 通知が依頼者に作られる（既存 notifications 再利用・§8）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "競合A社が値下げ"})
        ai_app.process_ai_jobs_once(db)
        with get_tenant_session(db) as ts:
            notifs = ts.query(Notification).filter_by(recipient_id=user_id).all()
            assert len(notifs) == 1 and notifs[0].type == "ai_task_done"
            assert notifs[0].params["task_type"] == "info_summarize"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_127_notify_failed_on_permanent_fail():
    """S-TC-127: 恒久失敗で ai_task_failed 通知（params.error 付き）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id, input={})
        ai_app.process_ai_jobs_once(db)
        with get_tenant_session(db) as ts:
            notifs = ts.query(Notification).filter_by(recipient_id=user_id).all()
            assert len(notifs) == 1 and notifs[0].type == "ai_task_failed"
            assert notifs[0].params.get("error", {}).get("code") == "invalid_input"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_process_all_companies_once_smoke():
    """全会社巡回＝有効会社を回して合算 stats を返す（1社の失敗で全体を止めない・§5.2a）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "巡回テスト"})
        agg = ai_app.process_all_companies_once()
        assert agg["companies"] >= 1 and agg["errors"] == 0
        assert agg["succeeded"] >= 1  # 投入したジョブが処理された
        with get_tenant_session(db) as ts:
            assert ai_repo.get(ts, jid).status == "succeeded"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_125_usage_aggregate_reflects_processed():
    """S-TC-125(int): 処理済ジョブの usage が会社×モデル×月の集計に一致（free=cost0・トークンは集計）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "集計テスト 要約対象"})
        ai_app.process_ai_jobs_once(db)
        now = datetime.now(timezone.utc)
        pym = now.year * 100 + now.month
        with get_tenant_session(db) as ts:
            agg = ai_repo.usage_aggregate(ts, period_ym=pym, model_key="qwen3-light")
            row = next(r for r in agg if r["model_key"] == "qwen3-light")
            assert row["count"] >= 1 and row["output_tokens"] >= 1 and row["cost_micros"] == 0
    finally:
        _cleanup(db, user_id, [jid] if jid else [])


def test_s_tc_107_reclaim_stuck_running():
    """S-TC-107: running のまま無更新の孤児は次巡で queued へ戻る（再実行可）。"""
    db = _seed_db()
    user_id = _mk_user(db)
    jid = None
    try:
        jid = ai_app.enqueue_ai_job(db, task_type="info_summarize", requested_by_id=user_id,
                                    input={"text": "y"})
        # 手動で running＋古い started_at にする（孤児を作る）。
        with get_tenant_session(db) as ts:
            job = ai_repo.get(ts, jid)
            job.status = "running"
            job.started_at = datetime.now(timezone.utc) - timedelta(seconds=99999)
            ts.commit()
        stats = ai_app.process_ai_jobs_once(db)
        assert stats["reclaimed"] == 1
        # 孤児は queued に戻り、同じ巡回で再確保→succeeded まで進む。
        with get_tenant_session(db) as ts:
            assert ai_repo.get(ts, jid).status == "succeeded"
    finally:
        _cleanup(db, user_id, [jid] if jid else [])
