"""ai_jobs の永続化（会社DB・データモデル §5.57-5.59・FR-45）。

状態機械の遷移とキュー取り出しを担う（テーブル自身がキュー＝mail_outbox と同思想）。呼び出し側 Tx に相乗
（commit は application が制御）。取り出しは `FOR UPDATE SKIP LOCKED` で N 件だけ確保＝多重ワーカーでも
二重取得しない（設計 §5.3）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.tenant.ai_jobs.orm import AiJob, AiUsageEvent, CompanyAiModelSetting


def create_job(
    session: Session,
    *,
    task_type: str,
    requested_by_id: uuid.UUID,
    input: dict,
    requested_model: str | None = None,
    execution: str = "queued",
    ref_idea_id: uuid.UUID | None = None,
    ref_quest_id: uuid.UUID | None = None,
    ref_strategy_document_id: uuid.UUID | None = None,
    ref_info_item_id: uuid.UUID | None = None,
) -> AiJob:
    job = AiJob(
        task_type=task_type,
        requested_by_id=requested_by_id,
        input=input,
        requested_model=requested_model,
        execution=execution,
        ref_idea_id=ref_idea_id,
        ref_quest_id=ref_quest_id,
        ref_strategy_document_id=ref_strategy_document_id,
        ref_info_item_id=ref_info_item_id,
    )
    session.add(job)
    session.flush()
    return job


def claim_queued(session: Session, limit: int) -> list[uuid.UUID]:
    """queued を最大 limit 件だけ running へ確保する（SKIP LOCKED・§5.3）。確保した id を返す。

    キャンセル要求済み（cancel_requested）は取り出さない＝application が別途 canceled 化する。
    """
    ids = session.execute(
        select(AiJob.id)
        .where(AiJob.status == "queued", AiJob.deleted_at.is_(None), AiJob.cancel_requested.is_(False))
        .order_by(AiJob.priority.desc(), AiJob.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    ).scalars().all()
    if ids:
        session.execute(
            update(AiJob)
            .where(AiJob.id.in_(ids))
            .values(status="running", started_at=datetime.now(timezone.utc))
        )
    return list(ids)


def get(session: Session, job_id: uuid.UUID) -> AiJob | None:
    return session.get(AiJob, job_id)


def cancel_queued_requested(session: Session) -> int:
    """cancel_requested の queued（未着手）を即 canceled にする（設計 §5.5）。件数を返す。"""
    now = datetime.now(timezone.utc)
    return session.execute(
        update(AiJob)
        .where(AiJob.status == "queued", AiJob.cancel_requested.is_(True), AiJob.deleted_at.is_(None))
        .values(status="canceled", finished_at=now)
    ).rowcount


def reclaim_stuck_running(session: Session, threshold: datetime) -> int:
    """running のまま threshold より前に開始し無更新の孤児を queued へ戻す（設計 §5.4）。件数を返す。"""
    return session.execute(
        update(AiJob)
        .where(AiJob.status == "running", AiJob.started_at < threshold, AiJob.deleted_at.is_(None))
        .values(status="queued", started_at=None)
    ).rowcount


def record_usage(
    session: Session,
    *,
    job_id: uuid.UUID | None,
    period_ym: int,
    model_key: str,
    provider: str,
    model: str,
    task_type: str,
    requested_by_id: uuid.UUID | None,
    billing: str,
    input_tokens: int,
    output_tokens: int,
    rate_snapshot: dict,
    cost_micros: int,
) -> AiUsageEvent:
    """課金基礎を1行 append（追記専用・§5.59）。"""
    ev = AiUsageEvent(
        job_id=job_id,
        period_ym=period_ym,
        model_key=model_key,
        provider=provider,
        model=model,
        task_type=task_type,
        requested_by_id=requested_by_id,
        billing=billing,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        rate_snapshot=rate_snapshot,
        cost_micros=cost_micros,
    )
    session.add(ev)
    session.flush()
    return ev


def enabled_model_keys(session: Session) -> set[str]:
    """会社で ON の論理キー集合（`company_ai_model_settings.enabled`・§5.58）。"""
    rows = session.execute(
        select(CompanyAiModelSetting.model_key).where(CompanyAiModelSetting.enabled.is_(True))
    ).scalars().all()
    return set(rows)
