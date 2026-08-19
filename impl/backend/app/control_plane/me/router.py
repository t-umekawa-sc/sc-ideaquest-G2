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
    EmailChangeAcceptedResponse,
    EmailChangeConfirmedResponse,
    EmailChangeConfirmRequest,
    EmailChangeRequest,
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
