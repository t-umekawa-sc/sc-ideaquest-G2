"""AIジョブ（ai_jobs）の DTO（API設計 S.1/S.2・データモデル §5.57）。

リクエストは `extra="forbid"`（想定外プロパティ拒否・§2.2）。task_type/model の妥当性は application 層で検証
（不正/無効/会社OFF は 422）。物理（provider/base_url）は API に露出しない＝機能側は論理キーのみ扱う。
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AiJobEnqueueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_type: str = Field(min_length=1, max_length=64)
    input: dict
    model: str | None = None  # 論理モデルキー（省略時 task_type 既定・S.2）
    ref_idea_id: str | None = None
    ref_quest_id: str | None = None
    ref_strategy_document_id: str | None = None
    ref_info_item_id: str | None = None


class AiJobEnqueueResponse(BaseModel):
    id: str
    status: str


class AiJobListItem(BaseModel):
    id: str
    task_type: str
    status: str
    progress: dict | None = None
    created_at: datetime
    finished_at: datetime | None = None
    ref_idea_id: str | None = None
    ref_quest_id: str | None = None
    ref_strategy_document_id: str | None = None
    ref_info_item_id: str | None = None


class PageInfo(BaseModel):
    page: int
    per_page: int
    total: int
    has_next: bool


class AiJobListResponse(BaseModel):
    data: list[AiJobListItem]
    page_info: PageInfo


class AiJobSummary(BaseModel):
    queued: int
    running: int
    recent_done: int
    recent_failed: int


class AiJobDetail(BaseModel):
    id: str
    task_type: str
    status: str
    execution: str
    requested_model: str | None = None
    provider: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_micros: int | None = None
    progress: dict | None = None
    error: dict | None = None
    result: dict | None = None
    ref_idea_id: str | None = None
    ref_quest_id: str | None = None
    ref_strategy_document_id: str | None = None
    ref_info_item_id: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AiModelItem(BaseModel):
    key: str
    provider: str
    external: bool
    billing: str
    is_default: bool


class AiModelListResponse(BaseModel):
    data: list[AiModelItem]
