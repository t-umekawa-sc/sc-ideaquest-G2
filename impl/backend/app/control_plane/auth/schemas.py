"""認証 API のリクエスト/レスポンス スキーマ（§3.2 DTO）。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    company_code: str = Field(min_length=1)
    login_id: str = Field(min_length=1)
    password: str = Field(min_length=1)
