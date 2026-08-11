"""`/admin/*` の入出力 DTO（Pydantic・§3.2 DB モデル直返し禁止・§B.6 不要項目を返さない）。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PageInfo(BaseModel):
    """オフセットページングの page_info（README §1.8）。"""
    total: int
    page: int
    per_page: int


class AccountListItem(BaseModel):
    """アカウント一覧の 1 行（SC-92・B.2）。`password_hash` 等の機密は含めない（§B.6）。

    所属グループ/グループ内ロール（会社DB `quest_group_members`）は後続スライスで付与する。
    """
    account_id: str
    display_name: str
    login_id: str
    email: str
    system_role: str
    status: str
    last_login_at: str | None = None


class AccountListResponse(BaseModel):
    data: list[AccountListItem]
    page_info: PageInfo


class AccountCreateRequest(BaseModel):
    """アカウント発行の入力（B.2・SC-92）。想定外プロパティは拒否（Mass Assignment 防止・§B.6）。

    `system_role` は enum 限定（`quest_group_admin` は不受理）。`memberships`（会社DB
    `quest_group_members`＝ドメインC領域）は本スライス非対応＝別スライスで追加する。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, max_length=255)
    login_id: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=1, max_length=255)
    system_role: Literal["general", "company_account_admin", "system_admin"] = "general"
    locale: Literal["ja", "en"] = "ja"


class AccountResponse(BaseModel):
    """発行/編集結果のアカウント（機密は含めない・§B.6）。"""
    account_id: str
    display_name: str
    login_id: str
    email: str
    system_role: str
    status: str
    password_set: bool
