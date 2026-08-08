"""認証 API のリクエスト/レスポンス スキーマ（§3.2 DTO）。

レスポンスモデルは OpenAPI に反映され、フロントの型付きクライアント codegen の入力になる。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    company_code: str = Field(min_length=1)
    login_id: str = Field(min_length=1)
    password: str = Field(min_length=1)


class SessionUser(BaseModel):
    user_id: str | None
    display_name: str
    avatar_url: str | None = None


class Session(BaseModel):
    """A.6 セッションスキーマ（GET /auth/session の応答・login authenticated 応答に内包）。"""

    account_id: str
    company_id: str
    company_code: str
    system_role: str
    locale: str
    user: SessionUser


class LoginResponse(BaseModel):
    status: str  # "authenticated" | "mfa_required"
    session: Session | None = None
    mfa: dict | None = None
