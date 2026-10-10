"""ai_jobs の永続化（会社DB・データモデル §5.57-5.59・FR-45）。

状態機械の遷移とキュー取り出しを担う（テーブル自身がキュー＝mail_outbox と同思想）。呼び出し側 Tx に相乗
（commit は application が制御）。取り出しは `FOR UPDATE SKIP LOCKED` で N 件だけ確保＝多重ワーカーでも
二重取得しない（設計 §5.3）。
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.tenant.ai_jobs.orm import AiJob, AiUsageEvent, CompanyAiModelSetting, CompanyAiSettings

# 一覧ソートのホワイトリスト（未知は 422・DataTable §1.8.1）。
_SORTS = {
    "-created_at": (AiJob.created_at.desc(),),
    "created_at": (AiJob.created_at.asc(),),
    "-finished_at": (AiJob.finished_at.desc().nullslast(),),
}
_STATUSES = {"queued", "running", "succeeded", "failed", "canceled"}


def create_job(
    session: Session,
    *,
    task_type: str,
    requested_by_id: uuid.UUID,
    input: dict,
    requested_model: str | None = None,
    execution: str = "queued",
    created_by_id: uuid.UUID | None = None,   # 起票主体（§2.1）＝ユーザー起票は本人／システム起票は NULL
    created_program: str | None = None,        # 起票処理の識別（システム起票の判別・'user'/'auto_evaluate' 等）
    ref_idea_id: uuid.UUID | None = None,
    ref_quest_id: uuid.UUID | None = None,
    ref_strategy_document_id: uuid.UUID | None = None,
    ref_info_item_id: uuid.UUID | None = None,
) -> AiJob:
    job = AiJob(
        task_type=task_type,
        requested_by_id=requested_by_id,
        created_by_id=created_by_id,
        created_program=created_program,
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


def set_progress(session: Session, job_id: uuid.UUID, progress: dict | None) -> None:
    """実行中ジョブの progress（ratio/phase/tokens）を更新（SC-04 進捗率の源・§5.6）。commit は呼び出し側。"""
    session.execute(update(AiJob).where(AiJob.id == job_id).values(progress=progress))


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
    """会社で明示 ON の論理キー集合（`company_ai_model_settings.enabled=True`・§5.58）。"""
    rows = session.execute(
        select(CompanyAiModelSetting.model_key).where(CompanyAiModelSetting.enabled.is_(True))
    ).scalars().all()
    return set(rows)


def model_settings(session: Session) -> dict[str, bool]:
    """会社の明示設定（model_key→enabled）。未登録キーは registry 既定にフォールバック（app 層）。"""
    rows = session.execute(
        select(CompanyAiModelSetting.model_key, CompanyAiModelSetting.enabled)
    ).all()
    return {k: bool(v) for k, v in rows}


# ---- 会社の AI 動作ポリシー（会社横断シングルトン・§5.67） ----

def get_ai_settings(session: Session) -> CompanyAiSettings | None:
    """会社の AI 動作ポリシー（シングルトン1行）を返す（無ければ None）。"""
    return session.execute(select(CompanyAiSettings).limit(1)).scalar_one_or_none()


def upsert_ai_settings(session: Session, *, auto_evaluate_on_publish: bool | None,
                       actor_id: uuid.UUID | None) -> CompanyAiSettings:
    """会社の AI 動作ポリシーを更新（無ければ作成）。`auto_evaluate_on_publish=None`＝env 既定継承。"""
    row = get_ai_settings(session)
    if row is None:
        row = CompanyAiSettings()
        session.add(row)
    row.auto_evaluate_on_publish = auto_evaluate_on_publish
    row.updated_by_id = actor_id
    session.flush()
    return row


def list_jobs(
    session: Session, *, requester_id: uuid.UUID, status: str | None, task_type: str | None,
    sort: str | None, page: int, per_page: int,
) -> tuple[list[AiJob], int]:
    """起票者スコープの一覧（サーバー委譲・S.1）＝(rows, total)。sort/status はホワイトリスト（未知は 422）。

    SC-04 個人一覧は **created_by_id（起票主体）** で絞る＝システム起票ジョブ（自動評価など・created_by_id=NULL）は
    本人の一覧に出さない（§6・§2.1）。ユーザー起票は created_by_id=requested_by_id なので従来表示と一致。
    """
    from app.core.errors import AppError

    conds = [AiJob.created_by_id == requester_id, AiJob.deleted_at.is_(None)]
    if status is not None:
        if status not in _STATUSES:
            raise AppError(422, "validation_error", detail="不正な status", errors=[{"field": "status", "code": "invalid_enum"}])
        conds.append(AiJob.status == status)
    if task_type is not None:
        conds.append(AiJob.task_type == task_type)
    order = _SORTS.get(sort or "-created_at")
    if order is None:
        raise AppError(422, "validation_error", detail="不正な sort", errors=[{"field": "sort", "code": "invalid_enum"}])
    total = session.execute(select(func.count()).select_from(AiJob).where(*conds)).scalar_one()
    rows = session.execute(
        select(AiJob).where(*conds).order_by(*order).offset((page - 1) * per_page).limit(per_page)
    ).scalars().all()
    return list(rows), int(total)


def summary(session: Session, requester_id: uuid.UUID, *, recent_days: int = 7) -> dict:
    """待ち/実行中/直近完了・失敗の件数（ヘッダーバッジ用・S.1）。SC-04 と同じく created_by_id（起票主体）で絞る。"""
    base = [AiJob.created_by_id == requester_id, AiJob.deleted_at.is_(None)]

    def _count(*extra):
        return int(session.execute(select(func.count()).select_from(AiJob).where(*base, *extra)).scalar_one())

    since = datetime.now(timezone.utc) - timedelta(days=recent_days)
    return {
        "queued": _count(AiJob.status == "queued"),
        "running": _count(AiJob.status == "running"),
        "recent_done": _count(AiJob.status == "succeeded", AiJob.finished_at >= since),
        "recent_failed": _count(AiJob.status == "failed", AiJob.finished_at >= since),
    }


def latest_by_ref(session: Session, *, task_type: str, ref_strategy_document_id: uuid.UUID) -> AiJob | None:
    """この経営資料に対する最新の task_type ジョブ（S.1a 類・strategy の生成表示用）。

    対象＝共有リソース（経営資料）に紐づくジョブゆえ依頼者で絞らない（呼び出し EP が管理者ガード）。
    """
    return session.execute(
        select(AiJob)
        .where(AiJob.task_type == task_type,
               AiJob.ref_strategy_document_id == ref_strategy_document_id,
               AiJob.deleted_at.is_(None))
        .order_by(AiJob.created_at.desc())
        .limit(1)
    ).scalars().first()


def running_progress(session: Session, *, exclude_requester_id: uuid.UUID) -> list[float | None]:
    """会社内 running の進捗 ratio のみを処理順で返す（S.1a・SC-04 上部）。

    **自分（exclude_requester_id）は除外**し、依頼者/入力/タスク種別は読まない＝占有スロットの
    可視化に限定（匿名・§S.7）。順序＝処理順（priority DESC, started_at ASC）。ratio は progress.jsonb
    の `ratio`（開始直後で未設定なら None）。
    """
    rows = session.execute(
        select(AiJob.progress)
        .where(AiJob.status == "running", AiJob.deleted_at.is_(None),
               AiJob.requested_by_id != exclude_requester_id)
        .order_by(AiJob.priority.desc(), AiJob.started_at.asc(), AiJob.id.asc())
    ).scalars().all()
    out: list[float | None] = []
    for p in rows:
        r = p.get("ratio") if isinstance(p, dict) else None
        out.append(float(r) if isinstance(r, (int, float)) else None)
    return out


def queue_info(session: Session, queued_ids: list[uuid.UUID], concurrency: int,
               *, avg_window_days: int = 7) -> dict[uuid.UUID, dict]:
    """queued ジョブの順番待ち位置＋概算 ETA（S.1・§5.3）。

    位置＝**会社全体**の queued を処理順（priority DESC, created_at ASC）で並べた順位（rn＝ユーザーの
    「N番目の待機ジョブ」）。ETA＝前方件数（実行中＋rn-1）÷同時実行数×直近平均処理時間（履歴が無ければ None）。
    通知内容や他人のジョブ本文は出さない＝件数のみ（存在秘匿と両立）。
    """
    if not queued_ids:
        return {}
    running = int(session.execute(
        select(func.count()).select_from(AiJob).where(AiJob.status == "running", AiJob.deleted_at.is_(None))
    ).scalar_one())
    ranked = session.execute(
        select(AiJob.id, func.row_number().over(
            order_by=(AiJob.priority.desc(), AiJob.created_at.asc(), AiJob.id.asc())))
        .where(AiJob.status == "queued", AiJob.deleted_at.is_(None), AiJob.cancel_requested.is_(False))
    ).all()
    rank = {rid: int(rn) for rid, rn in ranked}
    since = datetime.now(timezone.utc) - timedelta(days=avg_window_days)
    avg = session.execute(
        select(func.avg(func.extract("epoch", AiJob.finished_at - AiJob.started_at)))
        .where(AiJob.status == "succeeded", AiJob.finished_at.isnot(None),
               AiJob.started_at.isnot(None), AiJob.finished_at >= since)
    ).scalar()
    avg = float(avg) if avg is not None else None
    n = max(1, concurrency)
    out: dict[uuid.UUID, dict] = {}
    for jid in queued_ids:
        rn = rank.get(jid)
        if rn is None:
            continue
        ahead = running + rn - 1  # 自分が始まる前に片付く件数（実行中＋自分より前の待ち）
        eta = int(math.ceil(ahead / n) * avg) if avg is not None else None
        out[jid] = {"queue_position": rn, "eta_seconds": eta}
    return out


def get_for_requester(session: Session, job_id: uuid.UUID, requester_id: uuid.UUID) -> AiJob | None:
    """依頼者本人のジョブのみ返す（他人/削除済は None＝存在秘匿の 404 に写像）。"""
    job = session.get(AiJob, job_id)
    if job is None or job.deleted_at is not None or job.requested_by_id != requester_id:
        return None
    return job


def request_cancel(session: Session, job: AiJob) -> None:
    """キャンセル要求＝queued は即 canceled／running はフラグ（協調・§5.5）／終端は無操作。"""
    if job.status == "queued":
        job.status = "canceled"
        job.finished_at = datetime.now(timezone.utc)
    elif job.status == "running":
        job.cancel_requested = True


# ---- 会社モデル設定・課金（管理・§5.58/§5.59・S.5） ----

def get_model_setting(session: Session, model_key: str) -> CompanyAiModelSetting | None:
    return session.execute(
        select(CompanyAiModelSetting).where(CompanyAiModelSetting.model_key == model_key)
    ).scalar_one_or_none()


def upsert_model_setting(session: Session, model_key: str, *, enabled: bool | None,
                         monthly_budget_micros: int | None, max_output_tokens: int | None = None,
                         actor_id: uuid.UUID) -> CompanyAiModelSetting:
    """会社のモデル設定を作成/更新（enabled/予算/出力上限）。enabled=True 化時に enabled_by/at を記録（課金合意・§4.2）。"""
    row = get_model_setting(session, model_key)
    if row is None:
        row = CompanyAiModelSetting(model_key=model_key, enabled=False)
        session.add(row)
    if enabled is not None:
        if enabled and not row.enabled:  # OFF→ON＝課金合意の記録
            row.enabled_by_id = actor_id
            row.enabled_at = datetime.now(timezone.utc)
        row.enabled = enabled
    if monthly_budget_micros is not None:
        row.monthly_budget_micros = monthly_budget_micros
    if max_output_tokens is not None:
        row.max_output_tokens = max_output_tokens
    session.flush()
    return row


def month_cost(session: Session, period_ym: int) -> int:
    """当月の総コスト（予算判定用・§4.2）。"""
    return int(session.execute(
        select(func.coalesce(func.sum(AiUsageEvent.cost_micros), 0)).where(AiUsageEvent.period_ym == period_ym)
    ).scalar_one())


def month_cost_by_model(session: Session, period_ym: int) -> dict[str, dict]:
    """当月のモデル別利用（tokens/cost）＝GET /admin/ai-models の現況表示用。"""
    rows = session.execute(
        select(AiUsageEvent.model_key,
               func.coalesce(func.sum(AiUsageEvent.input_tokens), 0),
               func.coalesce(func.sum(AiUsageEvent.output_tokens), 0),
               func.coalesce(func.sum(AiUsageEvent.cost_micros), 0))
        .where(AiUsageEvent.period_ym == period_ym)
        .group_by(AiUsageEvent.model_key)
    ).all()
    return {k: {"input_tokens": int(i), "output_tokens": int(o), "cost_micros": int(c)} for k, i, o, c in rows}


def usage_aggregate(session: Session, *, period_ym: int | None, model_key: str | None) -> list[dict]:
    """会社×モデル×月の利用量集計（GET /admin/ai-usage・§6.3）。"""
    conds = []
    if period_ym is not None:
        conds.append(AiUsageEvent.period_ym == period_ym)
    if model_key is not None:
        conds.append(AiUsageEvent.model_key == model_key)
    rows = session.execute(
        select(AiUsageEvent.period_ym, AiUsageEvent.model_key,
               func.coalesce(func.sum(AiUsageEvent.input_tokens), 0),
               func.coalesce(func.sum(AiUsageEvent.output_tokens), 0),
               func.coalesce(func.sum(AiUsageEvent.cost_micros), 0),
               func.count())
        .where(*conds)
        .group_by(AiUsageEvent.period_ym, AiUsageEvent.model_key)
        .order_by(AiUsageEvent.period_ym.desc(), AiUsageEvent.model_key)
    ).all()
    return [{"period_ym": int(p), "model_key": k, "input_tokens": int(i), "output_tokens": int(o),
             "cost_micros": int(c), "count": int(n)} for p, k, i, o, c, n in rows]
