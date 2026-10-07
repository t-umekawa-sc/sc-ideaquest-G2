"""公開（未認証）プレーンのルータ（API設計 A §A.11.2-A.11.3・FR-48②）。

未認証で到達する公開導線。状態変更系（signup/verify）は Origin/Sec-Fetch を検証（SEC G）。
外周アクセスゲート（access_gate）は session が無い（未認証）ため素通し。
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from app.control_plane.public import application as public_service
from app.control_plane.public.schemas import (
    BootstrapResponse,
    SignupAcceptedResponse,
    SignupCreatedResponse,
    SignupRequest,
    SignupVerifyRequest,
)
from app.core.deps import get_client_ip, verify_origin
from app.infra.cache import get_redis

router = APIRouter(prefix="/api/v1/public", tags=["public"])


@router.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap() -> BootstrapResponse:
    """デプロイ既定会社コードの有無等（会社コード欄の出し分け・A.11.2・決定L）。"""
    return BootstrapResponse(**public_service.bootstrap())


@router.post("/signup", response_model=SignupAcceptedResponse, status_code=202)
def signup(request: Request, body: SignupRequest) -> SignupAcceptedResponse:
    """セルフサインアップ要求（A.11.3）＝一律 202・検証前に accounts を作らない（決定A・SEC A/B）。"""
    verify_origin(request)  # 未認証POST でも Origin/Sec-Fetch 検証（SEC G）。CSRF は Cookie 不要のため免除。
    result = public_service.signup(
        get_redis(), get_client_ip(request),
        company_code=body.company_code, login_id=body.login_id, email=body.email,
        display_name=body.display_name, password=body.password,
    )
    return SignupAcceptedResponse(**result)


@router.post("/signup/verify", response_model=SignupCreatedResponse)
def signup_verify(request: Request, body: SignupVerifyRequest) -> SignupCreatedResponse:
    """認証コード検証 → アカウント確定（A.11.3・SEC E/I）。自動ログインしない（セッション発行なし）。"""
    verify_origin(request)  # 未認証POST でも Origin/Sec-Fetch 検証（SEC G）。
    result = public_service.verify(company_code=body.company_code, email=body.email, code=body.code)
    return SignupCreatedResponse(**result)
