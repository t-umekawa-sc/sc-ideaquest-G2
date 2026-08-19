"""`/me` の入出力 DTO（Pydantic・§3.2 DB モデル直返し禁止・§2.2 Mass Assignment 防止）。"""
from __future__ import annotations

from datetime import datetime
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


class MeAccountDTO(BaseModel):
    """identity（accounts 源泉・K.1）＝ログインID/メール/ロケール。"""
    login_id: str
    email: str
    locale: str


class MeProfileDTO(BaseModel):
    """プロフィール表示（K.1）。display_name は accounts 源泉。画像は署名URL（K.4・未設定は None）。"""
    display_name: str
    avatar_image_url: str | None = None
    background_image_url: str | None = None


class MeBalanceDTO(BaseModel):
    """残高（会社DB `users`・読み取り専用・canonical は G の activities・K.0）。

    `level`/`xp_to_next`/`level_span` は G の純粋レベル関数（データモデル §7）で `xp` から算出。
    """
    level: int
    xp: int
    xp_to_next: int
    level_span: int
    coin_balance: int
    skill_point_balance: int


class MeResponse(BaseModel):
    """`GET /me`（正準・K.1）＝identity＋プロフィール＋残高。ダッシュボード hero も同読取（I.1 と両立）。"""
    account: MeAccountDTO
    profile: MeProfileDTO
    balance: MeBalanceDTO
    system_role: str


class MeActivityDTO(BaseModel):
    """活動履歴の1行（G の `activities` 元帳・G.6）。残高そのものではなく付与/消費の記録。

    `amount` は常に正・方向は `kind`（*_gain/*_spend）。`ref_type`/`ref_id` は多態参照（NULL 可・対でセット）。
    """
    id: str
    kind: str
    amount: int
    reason: str
    quest_id: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    created_at: datetime


class CursorPageInfo(BaseModel):
    """カーソルページングのページ情報（§1.8）。"""
    next_cursor: str | None = None
    has_next: bool


class MeActivitiesResponse(BaseModel):
    """`GET /me/activities`（履歴・G.6）＝カーソル一覧共通形（§1.8）。新しい順。"""
    data: list[MeActivityDTO]
    page_info: CursorPageInfo


class PasswordChangeRequest(BaseModel):
    """自己パスワード変更の入力（K.3・現在PW 再認証）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class EmailChangeRequest(BaseModel):
    """自己メール変更の**要求**（K.3・現在PW 再認証・ダブルオプトイン ADR-0008）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    new_email: str = Field(min_length=1, max_length=255)
    current_password: str = Field(min_length=1)


class EmailChangeAcceptedResponse(BaseModel):
    """メール変更要求の受理応答（202・確定待ち・ADR-0008）。この時点では未反映。"""
    status: str = "accepted"


class EmailChangeConfirmRequest(BaseModel):
    """メール変更の**確定**（K.3・未認証＝トークンが認可・ADR-0008 §2.3）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1)


class EmailChangeConfirmedResponse(BaseModel):
    """メール変更確定の応答（200・ADR-0008）。未認証 EP のため identity 全体は返さない。"""
    status: str = "confirmed"
