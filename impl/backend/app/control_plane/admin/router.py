"""アカウント管理ルータ（`/api/v1/admin`・imperative shell・ドメイン B）。

認可は Depends(require_system_admin)（B.0.1）。GET は CSRF 免除（A.1・状態変更なし）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.admin import application as admin_service
from app.control_plane.admin.deps import require_company_account_admin, require_system_admin
from app.control_plane.admin.schemas import (
    AccountCreateRequest,
    AccountCreateSelfRequest,
    AccountListResponse,
    AccountResponse,
    AccountUpdateRequest,
    AccountUpdateSelfRequest,
    PasswordResetResponse,
)
from app.core.deps import verify_csrf, verify_origin
from app.infra.cache import get_redis

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def _company_id(session: dict) -> uuid.UUID:
    """会社アカウント管理者 EP のスコープ＝セッション会社固定（B.2.1・`company_id` を受けない）。"""
    return uuid.UUID(session["company_id"])


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


@router.patch("/companies/{company_id}/accounts/{account_id}", response_model=AccountResponse)
def edit_company_account(
    company_id: uuid.UUID, account_id: uuid.UUID, body: AccountUpdateRequest, request: Request,
    session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウント編集（SC-92・B.2・差分・system_admin 専用）。変更系＝Origin/CSRF 必須（B.0.1 P3）。"""
    verify_origin(request)
    verify_csrf(request)
    result = admin_service.edit_account(
        company_id, account_id,
        changes=body.model_dump(exclude_unset=True),   # 指定フィールドのみ差分適用
        acting_account_id=session["account_id"], r=get_redis(),
    )
    return AccountResponse(**result)


@router.post("/companies/{company_id}/accounts/{account_id}/disable", response_model=AccountResponse)
def disable_account(
    company_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウント無効化（B.2・全セッション破棄＋信頼端末失効・`last_system_admin` 拒否）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.disable_account(company_id, account_id, get_redis()))


@router.post("/companies/{company_id}/accounts/{account_id}/enable", response_model=AccountResponse)
def enable_account(
    company_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウント再有効化（B.2）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.enable_account(company_id, account_id))


@router.post("/companies/{company_id}/accounts/{account_id}/password-reset", response_model=PasswordResetResponse)
def password_reset(
    company_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> PasswordResetResponse:
    """初回/再設定PWリンクを再送（B.2・A.7・旧リンク失効・非同期送信）。"""
    verify_origin(request)
    verify_csrf(request)
    return PasswordResetResponse(**admin_service.reset_password(company_id, account_id))


# --- 会社アカウント管理者（`/admin/accounts`・セッション会社固定・B.2.1） ---------------------
@router.get("/accounts", response_model=AccountListResponse)
def list_own_accounts(
    request: Request,
    q: str | None = None,
    status: str | None = Query(default=None, pattern="^(active|disabled)$"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    session: dict = Depends(require_company_account_admin),
) -> AccountListResponse:
    """自社アカウント一覧（SC-93・B.2.1）。"""
    result = admin_service.list_company_accounts(
        _company_id(session), q=q, status=status, page=page, per_page=per_page
    )
    return AccountListResponse(**result)


@router.post("/accounts", response_model=AccountResponse, status_code=201)
def issue_own_account(
    body: AccountCreateSelfRequest, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント発行（B.2.1・`system_role=general` 固定＝ロール付与は不可）。"""
    verify_origin(request)
    verify_csrf(request)
    result = admin_service.issue_account(
        _company_id(session),
        display_name=body.display_name, login_id=body.login_id, email=body.email,
        system_role="general", locale=body.locale,   # 会社アカ管理者は general のみ（B.2.1）
    )
    return AccountResponse(**result)


@router.patch("/accounts/{account_id}", response_model=AccountResponse)
def edit_own_account(
    account_id: uuid.UUID, body: AccountUpdateSelfRequest, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント編集（B.2.1・`system_role` 変更不可＝DTO が受け取らない）。"""
    verify_origin(request)
    verify_csrf(request)
    result = admin_service.edit_account(
        _company_id(session), account_id,
        changes=body.model_dump(exclude_unset=True),
        acting_account_id=session["account_id"], r=get_redis(),
    )
    return AccountResponse(**result)


@router.post("/accounts/{account_id}/disable", response_model=AccountResponse)
def disable_own_account(
    account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント無効化（B.2.1・**system_admin は無効化不可**＝403）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.disable_account(
        _company_id(session), account_id, get_redis(), forbid_system_admin_target=True
    ))


@router.post("/accounts/{account_id}/enable", response_model=AccountResponse)
def enable_own_account(
    account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント再有効化（B.2.1）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.enable_account(_company_id(session), account_id))


@router.post("/accounts/{account_id}/password-reset", response_model=PasswordResetResponse)
def password_reset_own_account(
    account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> PasswordResetResponse:
    """自社アカウントのPWリンク再送（B.2.1・A.7）。"""
    verify_origin(request)
    verify_csrf(request)
    return PasswordResetResponse(**admin_service.reset_password(_company_id(session), account_id))
