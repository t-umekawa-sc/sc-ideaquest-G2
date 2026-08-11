"""アカウント管理ルータ（`/api/v1/admin`・imperative shell・ドメイン B）。

認可は Depends(require_system_admin)（B.0.1）。GET は CSRF 免除（A.1・状態変更なし）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.admin import application as admin_service
from app.control_plane.admin.deps import require_system_admin
from app.control_plane.admin.schemas import (
    AccountCreateRequest,
    AccountListResponse,
    AccountResponse,
)
from app.core.deps import verify_csrf, verify_origin

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/companies/{company_id}/accounts", response_model=AccountListResponse)
def list_company_accounts(
    company_id: uuid.UUID,
    request: Request,
    q: str | None = None,
    status: str | None = Query(default=None, pattern="^(active|disabled)$"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    _session: dict = Depends(require_system_admin),
) -> AccountListResponse:
    """会社のアカウント一覧（SC-92・B.2・system_admin 専用）。"""
    result = admin_service.list_company_accounts(
        company_id, q=q, status=status, page=page, per_page=per_page
    )
    return AccountListResponse(**result)


@router.post("/companies/{company_id}/accounts", response_model=AccountResponse, status_code=201)
def issue_company_account(
    company_id: uuid.UUID,
    body: AccountCreateRequest,
    request: Request,
    _session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウントを発行（SC-92・B.2・system_admin 専用）。変更系＝Origin/CSRF 必須（B.0.1 P3）。"""
    verify_origin(request)      # 認可（Depends）の後に CSRF/Origin（P3）
    verify_csrf(request)
    result = admin_service.issue_account(
        company_id,
        display_name=body.display_name, login_id=body.login_id, email=body.email,
        system_role=body.system_role, locale=body.locale,
    )
    return AccountResponse(**result)
