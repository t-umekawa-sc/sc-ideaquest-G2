"""経営資料（strategy_documents）の DTO（API設計 R.1・データモデル §5.54）。

リクエストは `extra="forbid"`（想定外プロパティ拒否・§2.2）。doc_kind/status はホワイトリスト検証（application 層）。
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

DOC_KINDS = ("midterm_plan", "policy", "strategy", "other")


class StrategyDocCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    doc_kind: str = "other"
    intent: str | None = None
    policy_commitment: str | None = None
    strategy: str | None = None
    focus_areas: list[str] = Field(default_factory=list)
    objectives: str | None = None
    body_md: str | None = None
    period_from: date | None = None
    period_to: date | None = None


class StrategyDocUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    doc_kind: str | None = None
    intent: str | None = None
    policy_commitment: str | None = None
    strategy: str | None = None
    focus_areas: list[str] | None = None
    objectives: str | None = None
    body_md: str | None = None
    period_from: date | None = None
    period_to: date | None = None
    status: str | None = None  # active/archived（archive エンドポイントとは別に PATCH でも可）


class StrategyDocListItem(BaseModel):
    id: str
    title: str
    doc_kind: str
    status: str
    focus_areas: list[str]
    period_from: date | None
    period_to: date | None
    updated_at: datetime


class StrategyDocDetail(BaseModel):
    id: str
    title: str
    doc_kind: str
    intent: str | None
    policy_commitment: str | None
    strategy: str | None
    focus_areas: list[str]
    objectives: str | None
    body_md: str | None
    period_from: date | None
    period_to: date | None
    status: str
    created_by: str | None  # display_name
    created_at: datetime
    updated_at: datetime


class StrategyDocSelectionItem(BaseModel):
    """クエストの適用資料 選択用 軽量表現（R.0・全文/率は返さない）。"""
    id: str
    title: str
    doc_kind: str
    period_from: date | None
    period_to: date | None


class PageInfo(BaseModel):
    page: int
    per_page: int
    total: int
    has_next: bool


class StrategyDocListResponse(BaseModel):
    data: list[StrategyDocListItem]
    page_info: PageInfo


class StrategyDocSelectionResponse(BaseModel):
    data: list[StrategyDocSelectionItem]
