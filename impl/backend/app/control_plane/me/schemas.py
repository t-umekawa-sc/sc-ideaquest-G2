"""`/me` の入出力 DTO（Pydantic・§3.2 DB モデル直返し禁止・§2.2 Mass Assignment 防止）。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MeUpdateRequest(BaseModel):
    """プロフィール編集の入力（K.2・allowlist）。**`display_name`/`locale` のみ**受理。

    残高・`system_role`・`status`・`password_set`・`login_id`・`email` は編集不可＝想定外プロパティは
    拒否（extra=forbid＝Mass Assignment 防止・§2.2）。email/PW は K.3 の専用 EP（再認証）。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    locale: Literal["ja", "en"] | None = None


class MeProfileResponse(BaseModel):
    """自己プロフィールの identity 部分（K.1 のうち accounts 源泉の項目）。

    残高・画像（署名URL）は会社DB `users` 由来で `GET /me` 全体（K.1）＝別スライス。
    """
    login_id: str
    email: str
    display_name: str
    locale: str
    system_role: str


class PasswordChangeRequest(BaseModel):
    """自己パスワード変更の入力（K.3・現在PW 再認証）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class EmailChangeRequest(BaseModel):
    """自己メール変更の入力（K.3・現在PW 再認証）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    new_email: str = Field(min_length=1, max_length=255)
    current_password: str = Field(min_length=1)
