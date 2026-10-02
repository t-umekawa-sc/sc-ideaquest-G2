"""AIジョブルータ（`/api/v1`・テナントプレーン・ドメイン S・FR-45）。

認可＝依頼者本人スコープ（require_me・自分のジョブのみ・他人は 404）。会社/アカウントはセッション由来（§1.5）。
変更系（enqueue/cancel）は CSRF/Origin 検証（A.0）。通常は各機能 EP が内部 enqueue し、`POST /ai-jobs` は
汎用口（管理/デバッグ）＝enqueue は 202 相当（結果は待たない・S.1）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.admin.deps import require_company_account_admin
from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.ai_jobs import application as service
from app.tenant.ai_jobs.schemas import (
    AdminModelListResponse,
    AdminModelPatchRequest,
    AiJobDetail,
    AiJobEnqueueRequest,
    AiJobEnqueueResponse,
    AiJobListResponse,
    AiJobSummary,
    AiModelListResponse,
    AiUsageResponse,
    RunningListResponse,
)

router = APIRouter(prefix="/api/v1", tags=["ai-jobs"])


def _uuid_or_none(v: str | None) -> uuid.UUID | None:
    return uuid.UUID(v) if v else None


@router.get("/ai-models", response_model=AiModelListResponse)
def list_ai_models(request: Request, task_type: str | None = None,
                   session: dict = Depends(require_me)):
    return service.list_models(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), task_type)


@router.get("/ai-jobs", response_model=AiJobListResponse)
def list_ai_jobs(request: Request, status: str | None = None, task_type: str | None = None,
                 sort: str | None = None, page: int = 1, per_page: int = 20,
                 session: dict = Depends(require_me)):
    return service.list_jobs(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                             status=status, task_type=task_type, sort=sort, page=page, per_page=per_page)


@router.get("/ai-jobs/summary", response_model=AiJobSummary)
def ai_jobs_summary(request: Request, session: dict = Depends(require_me)):
    return service.summary(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))


@router.get("/ai-jobs/running", response_model=RunningListResponse)
def ai_jobs_running(request: Request, session: dict = Depends(require_me)):
    # SC-04 上部＝会社内 running の進捗率のみ（自分除外・匿名・S.1a）。`/ai-jobs/{job_id}` より前に登録。
    return service.list_running(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))


@router.get("/ai-jobs/{job_id}", response_model=AiJobDetail)
def get_ai_job(job_id: str, request: Request, session: dict = Depends(require_me)):
    return service.get_job(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), job_id)


@router.post("/ai-jobs", response_model=AiJobEnqueueResponse, status_code=202,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def enqueue_ai_job(body: AiJobEnqueueRequest, request: Request, session: dict = Depends(require_me)):
    return service.enqueue(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        task_type=body.task_type, input=body.input, requested_model=body.model,
        ref_idea_id=_uuid_or_none(body.ref_idea_id), ref_quest_id=_uuid_or_none(body.ref_quest_id),
        ref_strategy_document_id=_uuid_or_none(body.ref_strategy_document_id),
        ref_info_item_id=_uuid_or_none(body.ref_info_item_id),
    )


@router.post("/ai-jobs/{job_id}/cancel", response_model=AiJobDetail,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def cancel_ai_job(job_id: str, request: Request, session: dict = Depends(require_me)):
    return service.cancel_job(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), job_id)


# ---- 管理（会社モデル ON/OFF・予算・利用量・S.5・company_account_admin） ----

@router.get("/admin/ai-models", response_model=AdminModelListResponse)
def admin_list_ai_models(request: Request, session: dict = Depends(require_company_account_admin)):
    return service.admin_list_models(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))


@router.patch("/admin/ai-models/{key}", response_model=AdminModelListResponse,
              dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def admin_patch_ai_model(key: str, body: AdminModelPatchRequest, request: Request,
                         session: dict = Depends(require_company_account_admin)):
    return service.admin_patch_model(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                                     key, enabled=body.enabled, monthly_budget_micros=body.monthly_budget_micros)


@router.get("/admin/ai-usage", response_model=AiUsageResponse)
def admin_ai_usage(request: Request, period_ym: int | None = None, model_key: str | None = None,
                   session: dict = Depends(require_company_account_admin)):
    return service.admin_usage(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                               period_ym=period_ym, model_key=model_key)
