"""`/admin/*` の入出力 DTO（Pydantic・§3.2 DB モデル直返し禁止・§B.6 不要項目を返さない）。"""
from __future__ import annotations

from pydantic import BaseModel


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
