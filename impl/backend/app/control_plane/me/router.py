"""自己プロフィールルータ（`/api/v1/me`・imperative shell・ドメイン K）。

認可は Depends(require_me)（P1/P2）。変更系は Origin/CSRF 必須（A.0・認証→Origin→CSRF の順）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.me import application as me_service
from app.control_plane.me.deps import require_me
from app.control_plane.me.schemas import (
    EmailChangeRequest,
    MeProfileResponse,
    MeUpdateRequest,
    PasswordChangeRequest,
)
from app.core.deps import verify_csrf, verify_origin
from app.infra.cache import get_redis

router = APIRouter(prefix="/api/v1", tags=["me"])


@router.get("/me", response_model=MeProfileResponse)
def get_me(request: Request, session: dict = Depends(require_me)) -> MeProfileResponse:
    """自分のプロフィール（identity・K.1）。残高・画像（署名URL）は K.1 全体＝別スライス。"""
    return MeProfileResponse(**me_service.get_me(uuid.UUID(session["account_id"])))


@router.patch("/me", response_model=MeProfileResponse)
def update_me(
    body: MeUpdateRequest, request: Request, session: dict = Depends(require_me),
) -> MeProfileResponse:
    """表示名・ロケールを編集（K.2）。accounts 更新＋会社DB users ミラー enqueue。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    result = me_service.update_me(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        changes=body.model_dump(exclude_unset=True),  # 指定フィールドのみ（allowlist は DTO＋application で二重防御）
    )
    return MeProfileResponse(**result)


@router.post("/me/password", status_code=204)
def change_password(
    body: PasswordChangeRequest, request: Request, session: dict = Depends(require_me),
) -> None:
    """自己パスワード変更（K.3）。現在PW 再認証→ポリシー検証→更新→全セッション破棄（要再ログイン）。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    me_service.change_password(
        get_redis(), uuid.UUID(session["account_id"]),
        current_password=body.current_password, new_password=body.new_password,
    )


@router.post("/me/email", response_model=MeProfileResponse)
def change_email(
    body: EmailChangeRequest, request: Request, session: dict = Depends(require_me),
) -> MeProfileResponse:
    """自己メール変更（K.3）。現在PW 再認証→会社内一意→accounts.email 更新＋users ミラー。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    return MeProfileResponse(**me_service.change_email(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        new_email=body.new_email, current_password=body.current_password,
    ))
