"""自己プロフィールルータ（`/api/v1/me`・imperative shell・ドメイン K）。

認可は Depends(require_me)（P1/P2）。変更系は Origin/CSRF 必須（A.0・認証→Origin→CSRF の順）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.me import application as me_service
from app.control_plane.me.deps import require_me
from app.control_plane.me.schemas import MeProfileResponse, MeUpdateRequest
from app.core.deps import verify_csrf, verify_origin

router = APIRouter(prefix="/api/v1", tags=["me"])


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
