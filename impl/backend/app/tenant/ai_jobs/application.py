"""AIジョブ基盤のユースケース（enqueue＋状態機械 process_once・FR-45・設計 §5）。

`enqueue_ai_job` は各機能ドメイン/汎用EPが呼ぶ（202＝ジョブID を返すだけ）。`process_ai_jobs_once` を
llm_worker.py がループで呼ぶ（テストは本関数を直接呼ぶ＝常駐不要）。ゲートウェイ呼び出しは `infra/llm`
（テストは FakeChat 注入＝外部未接続）。同時実行 N は最小スペック向けに既定1（config・§5.3）。

**Phase1 縦1本＝`info_summarize`**＝input.text を要約するだけ（機微本文の参照ID解決は follow-up・§10）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth.orm import Company
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.llm import gateway, registry
from app.tenant.ai_jobs import repository as repo
from app.tenant.ai_jobs.orm import AiJob
from app.tenant.profile import repository as profile_repo

# free 論理キーの単価スナップショット（自社ホスト＝従量課金なし・§4.2/§5.59）。
_FREE_RATE = {"input_rate": 0, "output_rate": 0, "currency": "JPY", "pricing_version": "phase1-free"}


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _effective_enabled_keys(ts) -> set[str]:
    """会社で実際に使える論理キー集合（§4.2 2階層）＝free 既定 ON／paid 既定 OFF に明示設定を上書き。"""
    explicit = repo.model_settings(ts)  # 明示 ON/OFF
    result: set[str] = set()
    for key, billing in registry.catalog_billing().items():
        if key in explicit:
            if explicit[key]:
                result.add(key)
        elif billing == "free":  # 未登録の free は既定 ON
            result.add(key)
    return result


def _detail(job: AiJob) -> dict:
    return {
        "id": str(job.id), "task_type": job.task_type, "status": job.status, "execution": job.execution,
        "requested_model": job.requested_model, "provider": job.provider, "model": job.model,
        "input_tokens": job.input_tokens, "output_tokens": job.output_tokens, "cost_micros": job.cost_micros,
        "progress": job.progress, "error": job.error, "result": job.result,
        "ref_idea_id": str(job.ref_idea_id) if job.ref_idea_id else None,
        "ref_quest_id": str(job.ref_quest_id) if job.ref_quest_id else None,
        "ref_strategy_document_id": str(job.ref_strategy_document_id) if job.ref_strategy_document_id else None,
        "ref_info_item_id": str(job.ref_info_item_id) if job.ref_info_item_id else None,
        "created_at": job.created_at, "started_at": job.started_at, "finished_at": job.finished_at,
    }


def _list_item(job: AiJob) -> dict:
    return {
        "id": str(job.id), "task_type": job.task_type, "status": job.status,
        "progress": job.progress, "created_at": job.created_at, "finished_at": job.finished_at,
        "ref_idea_id": str(job.ref_idea_id) if job.ref_idea_id else None,
        "ref_quest_id": str(job.ref_quest_id) if job.ref_quest_id else None,
        "ref_strategy_document_id": str(job.ref_strategy_document_id) if job.ref_strategy_document_id else None,
        "ref_info_item_id": str(job.ref_info_item_id) if job.ref_info_item_id else None,
    }


# ---- API 向け（account_id/company_id 解決＋依頼者スコープ・S.0/S.1/S.2） ----

def enqueue(account_id: uuid.UUID, company_id: uuid.UUID, *, task_type: str, input: dict,
            requested_model: str | None = None, ref_idea_id: uuid.UUID | None = None,
            ref_quest_id: uuid.UUID | None = None, ref_strategy_document_id: uuid.UUID | None = None,
            ref_info_item_id: uuid.UUID | None = None) -> dict:
    """ジョブ投入（202＝{id, status}）。モデル指定は registry＋会社有効性で検証（不正/無効/会社OFF は 422）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if requested_model is not None:
            try:
                registry.resolve_key(task_type, requested_model)  # 存在/有効（registry 既定）
            except gateway.LLMConfigError:
                raise AppError(422, "validation_error", detail="不正なモデル指定",
                               errors=[{"field": "model", "code": "invalid_model"}])
            if requested_model not in _effective_enabled_keys(ts):  # 会社で ON か（§4.2）
                raise AppError(422, "validation_error", detail="このモデルは会社で無効です",
                               errors=[{"field": "model", "code": "model_disabled"}])
        job = repo.create_job(ts, task_type=task_type, requested_by_id=user.id, input=input,
                              requested_model=requested_model, ref_idea_id=ref_idea_id,
                              ref_quest_id=ref_quest_id, ref_strategy_document_id=ref_strategy_document_id,
                              ref_info_item_id=ref_info_item_id)
        out = {"id": str(job.id), "status": job.status}
        ts.commit()
    return out


def list_jobs(account_id: uuid.UUID, company_id: uuid.UUID, *, status=None, task_type=None,
              sort=None, page: int = 1, per_page: int = 20) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    page = max(1, page or 1)
    per_page = min(100, max(1, per_page or 20))
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        rows, total = repo.list_jobs(ts, requester_id=user.id, status=status, task_type=task_type,
                                     sort=sort, page=page, per_page=per_page)
        return {"data": [_list_item(j) for j in rows],
                "page_info": {"page": page, "per_page": per_page, "total": total,
                              "has_next": page * per_page < total}}


def summary(account_id: uuid.UUID, company_id: uuid.UUID) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        return repo.summary(ts, user.id)


def get_job(account_id: uuid.UUID, company_id: uuid.UUID, job_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        job = repo.get_for_requester(ts, uuid.UUID(job_id), user.id)
        if job is None:
            raise AppError(404, "not_found")
        return _detail(job)


def cancel_job(account_id: uuid.UUID, company_id: uuid.UUID, job_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        job = repo.get_for_requester(ts, uuid.UUID(job_id), user.id)
        if job is None:
            raise AppError(404, "not_found")
        repo.request_cancel(ts, job)
        out = _detail(job)
        ts.commit()
    return out


def list_models(account_id: uuid.UUID, company_id: uuid.UUID, task_type: str | None = None) -> dict:
    """会社で有効な論理キーを返す（`GET /ai-models`・S.2・ピッカー供給源）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        enabled = _effective_enabled_keys(ts)
    return {"data": registry.list_models(task_type, enabled_keys=enabled)}


def enqueue_ai_job(
    db_identifier: str,
    *,
    task_type: str,
    requested_by_id: uuid.UUID,
    input: dict,
    requested_model: str | None = None,
    ref_idea_id: uuid.UUID | None = None,
    ref_quest_id: uuid.UUID | None = None,
    ref_strategy_document_id: uuid.UUID | None = None,
    ref_info_item_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """ジョブを queued で投入し、ジョブID を返す（202 相当・結果は待たない）。

    モデル指定（requested_model）は registry で検証＝不正/無効は LLMConfigError（呼び出し側で 422）。
    """
    if requested_model is not None:
        registry.resolve_key(task_type, requested_model)  # 検証（副作用で例外）
    with get_tenant_session(db_identifier) as session:
        job = repo.create_job(
            session,
            task_type=task_type,
            requested_by_id=requested_by_id,
            input=input,
            requested_model=requested_model,
            ref_idea_id=ref_idea_id,
            ref_quest_id=ref_quest_id,
            ref_strategy_document_id=ref_strategy_document_id,
            ref_info_item_id=ref_info_item_id,
        )
        job_id = job.id
        session.commit()
    return job_id


def _build_messages(job: AiJob) -> list[dict]:
    """task_type ごとにプロンプトを組む（Phase1 は info_summarize のみ）。"""
    if job.task_type == "info_summarize":
        text = (job.input or {}).get("text", "")
        if not text:
            raise _PermanentError("input.text is required for info_summarize")
        return [
            {"role": "system", "content": "次の文章を日本語で簡潔に要約してください。"},
            {"role": "user", "content": str(text)},
        ]
    raise _PermanentError(f"unsupported task_type: {job.task_type}")


class _PermanentError(Exception):
    """入力不正など恒久失敗（リトライしない＝即 failed）。"""


def process_ai_jobs_once(db_identifier: str) -> dict:
    """1 巡だけ処理する（§5.3/§5.4）。処理件数の要約を返す。llm_worker がループで呼ぶ。

    (0) 孤児回収＋queued キャンセル反映 → (1) N 件確保（queued→running）→ (2) 1 件ずつ実行。
    """
    s = get_settings()
    stats = {"succeeded": 0, "failed": 0, "canceled": 0, "reclaimed": 0}
    threshold = datetime.now(timezone.utc) - timedelta(seconds=s.llm_job_running_reclaim_seconds)
    with get_tenant_session(db_identifier) as session:
        stats["reclaimed"] = repo.reclaim_stuck_running(session, threshold)
        stats["canceled"] = repo.cancel_queued_requested(session)
        job_ids = repo.claim_queued(session, s.llm_worker_concurrency)
        session.commit()

    for job_id in job_ids:
        outcome = _process_one(db_identifier, job_id)
        if outcome in stats:
            stats[outcome] += 1
    return stats


def _process_one(db_identifier: str, job_id: uuid.UUID) -> str:
    """1 件を実行する＝ゲートウェイ呼び出し→成功で succeeded＋usage 記録／失敗で retry/failed。"""
    s = get_settings()
    # 1) 実行に必要な値を読み出す（別 Tx＝running は確保済み）。
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None or job.status != "running":
            return "skip"
        task_type, requested_model = job.task_type, job.requested_model
        try:
            messages = _build_messages(job)
        except _PermanentError as exc:
            job.status = "failed"
            job.error = {"code": "invalid_input", "detail": str(exc)}
            job.finished_at = datetime.now(timezone.utc)
            session.commit()
            return "failed"
        requester = job.requested_by_id

    # 2) 論理キー解決＋ゲートウェイ呼び出し（DB 接続を持たずに）。
    try:
        key = registry.resolve_key(task_type, requested_model)
        spec = registry.get(key)
        result = gateway.complete(task_type, messages, model=key)
    except gateway.LLMConfigError as exc:
        return _fail_permanent(db_identifier, job_id, "invalid_model", str(exc))
    except gateway.LLMUnavailable as exc:
        return _fail_retryable(db_identifier, job_id, str(exc), s.llm_job_max_attempts)

    # 3) 成功＝succeeded＋result＋usage 記録（課金基礎は追記専用台帳へ）。
    now = datetime.now(timezone.utc)
    period_ym = now.year * 100 + now.month
    cost_micros = 0  # Phase1 は free のみ（従量課金なし・§4.2）
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None:
            return "skip"
        job.status = "succeeded"
        job.result = {"text": result.text}
        job.provider = result.provider
        job.model = result.model
        job.input_tokens = result.input_tokens
        job.output_tokens = result.output_tokens
        job.cost_micros = cost_micros
        job.finished_at = now
        repo.record_usage(
            session,
            job_id=job.id,
            period_ym=period_ym,
            model_key=key,
            provider=result.provider,
            model=result.model,
            task_type=task_type,
            requested_by_id=requester,
            billing=spec.billing,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            rate_snapshot=_FREE_RATE,
            cost_micros=cost_micros,
        )
        session.commit()
    return "succeeded"


def _fail_permanent(db_identifier: str, job_id: uuid.UUID, code: str, detail: str) -> str:
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None:
            return "skip"
        job.status = "failed"
        job.error = {"code": code, "detail": detail}
        job.finished_at = datetime.now(timezone.utc)
        session.commit()
    return "failed"


def _fail_retryable(db_identifier: str, job_id: uuid.UUID, detail: str, max_attempts: int) -> str:
    """到達不能等＝attempts++。上限未満は queued（次巡で再試行）、上限で failed。"""
    with get_tenant_session(db_identifier) as session:
        job = repo.get(session, job_id)
        if job is None:
            return "skip"
        job.attempts += 1
        if job.attempts >= max_attempts:
            job.status = "failed"
            job.error = {"code": "llm_unavailable", "detail": detail}
            job.finished_at = datetime.now(timezone.utc)
        else:
            job.status = "queued"  # 次巡で再試行
            job.started_at = None
        session.commit()
    return "failed" if job is not None and job.status == "failed" else "retry"
