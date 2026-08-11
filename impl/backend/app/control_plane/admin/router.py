"""アカウント管理ルータ（`/api/v1/admin`・imperative shell・ドメイン B）。

認可は Depends(require_system_admin)（B.0.1）。GET は CSRF 免除（A.1・状態変更なし）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.admin import application as admin_service
from app.control_plane.admin.deps import require_system_admin
from app.control_plane.admin.schemas import AccountListResponse

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
