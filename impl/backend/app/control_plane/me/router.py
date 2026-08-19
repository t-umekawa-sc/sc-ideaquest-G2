"""自己プロフィールルータ（`/api/v1/me`・imperative shell・ドメイン K）。

認可は Depends(require_me)（P1/P2）。変更系は Origin/CSRF 必須（A.0・認証→Origin→CSRF の順）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from app.control_plane.me import application as me_service
from app.control_plane.me.deps import require_me
from app.control_plane.me.schemas import (
    AvatarImageResponse,
    BackgroundImageResponse,
    EmailChangeAcceptedResponse,
    EmailChangeConfirmedResponse,
    EmailChangeConfirmRequest,
    EmailChangeRequest,
    MeActivitiesResponse,
    MeResponse,
    MeUpdateRequest,
    PasswordChangeRequest,
)
from app.core.deps import verify_csrf, verify_origin
from app.infra.cache import get_redis

router = APIRouter(prefix="/api/v1", tags=["me"])


@router.get("/me", response_model=MeResponse)
def get_me(request: Request, session: dict = Depends(require_me)) -> MeResponse:
    """自分のプロフィール＋残高（正準・K.1）。identity＝accounts／残高＝会社DB users。画像署名URL は K.4 で。"""
    return MeResponse(**me_service.get_me(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
    ))


@router.get("/me/activities", response_model=MeActivitiesResponse)
def get_my_activities(
    request: Request,
    kind: Literal["xp_gain", "coin_gain", "coin_spend", "sp_gain", "sp_spend"] | None = None,
    period: Literal["this_week", "last_week", "this_month", "all"] = "all",
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> MeActivitiesResponse:
    """自分の活動履歴（G.6・新しい順・カーソル §1.8）。`kind`/`period` で絞り込み。読取専用。"""
    result = me_service.get_my_activities(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        kind=kind, period=period, limit=limit, cursor=cursor,
    )
    return MeActivitiesResponse(**result)


@router.patch("/me", response_model=MeResponse)
def update_me(
    body: MeUpdateRequest, request: Request, session: dict = Depends(require_me),
) -> MeResponse:
    """表示名・ロケールを編集（K.2）。accounts 更新＋会社DB users ミラー enqueue。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    result = me_service.update_me(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        changes=body.model_dump(exclude_unset=True),  # 指定フィールドのみ（allowlist は DTO＋application で二重防御）
    )
    return MeResponse(**result)


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


@router.put("/me/avatar-image", response_model=AvatarImageResponse)
async def put_avatar_image(
    request: Request, file: UploadFile = File(...), session: dict = Depends(require_me),
) -> AvatarImageResponse:
    """プロフィールアバター画像を設定（K.4・multipart）。会社DB users 直接更新＋短TTL 署名URL 返却。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    data = await file.read()
    result = me_service.set_avatar_image(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        data=data, content_type=file.content_type or "",
    )
    return AvatarImageResponse(**result)


@router.delete("/me/avatar-image", status_code=204)
def delete_avatar_image(request: Request, session: dict = Depends(require_me)) -> None:
    """アバター画像を削除（既定に戻す・K.4）。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    me_service.delete_avatar_image(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))


@router.put("/me/background-image", response_model=BackgroundImageResponse)
async def put_background_image(
    request: Request, file: UploadFile = File(...), session: dict = Depends(require_me),
) -> BackgroundImageResponse:
    """コンテンツ背景画像を設定（K.4・全認証画面に反映・multipart）。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    data = await file.read()
    result = me_service.set_background_image(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        data=data, content_type=file.content_type or "",
    )
    return BackgroundImageResponse(**result)


@router.delete("/me/background-image", status_code=204)
def delete_background_image(request: Request, session: dict = Depends(require_me)) -> None:
    """背景画像をリセット（既定背景へ・K.4）。変更系＝Origin/CSRF 必須。"""
    verify_origin(request)
    verify_csrf(request)
    me_service.delete_background_image(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))


@router.post("/me/email", response_model=EmailChangeAcceptedResponse, status_code=202)
def request_email_change(
    body: EmailChangeRequest, request: Request, session: dict = Depends(require_me),
) -> EmailChangeAcceptedResponse:
    """自己メール変更を**要求**（K.3・ダブルオプトイン ADR-0008）。現在PW 再認証→pending 化→新メールへ確認リンク。

    202（確定待ち＝この時点では未反映）。変更系＝Origin/CSRF 必須。確定は `POST /me/email/confirm`。
    """
    verify_origin(request)
    verify_csrf(request)
    me_service.request_email_change(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        new_email=body.new_email, current_password=body.current_password,
    )
    return EmailChangeAcceptedResponse()


@router.post("/me/email/confirm", response_model=EmailChangeConfirmedResponse)
def confirm_email_change(
    body: EmailChangeConfirmRequest, request: Request,
) -> EmailChangeConfirmedResponse:
    """メール変更の**確定**（K.3・ADR-0008）。**未認証＝トークンが認可**（新メール受信＝到達確認）。

    `password-setup/complete` と同型＝セッション不要・CSRF 免除（トークンが唯一の資格）・Origin のみ検証。
    無効/期限切れ/使用済みトークンは 410。
    """
    verify_origin(request)  # 未認証だが状態変更＝Origin/Sec-Fetch は検証（password-setup/complete と同じ）
    me_service.confirm_email_change(body.token)
    return EmailChangeConfirmedResponse()
