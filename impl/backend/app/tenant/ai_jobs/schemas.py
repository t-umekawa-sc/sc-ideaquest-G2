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
    queue_position: int | None = None  # queued のみ＝会社全体の待ち行列での順位（N番目）
    eta_seconds: int | None = None     # queued のみ＝概算の実行開始まで秒数（履歴無しは null）
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


class RunningJobItem(BaseModel):
    # SC-04 上部の「他ユーザ含む会社内 running」＝進捗率のみ（匿名）。依頼者/入力/タスク種別は出さない（S.1a/S.7）。
    ratio: float | None = None


class RunningListResponse(BaseModel):
    data: list[RunningJobItem]


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
    label: str          # ピッカー表示名（key を出さず表示名で選ばせる・設計§9.2）
    description: str     # 用途説明（ピッカー副文・設計§9.2）
    is_default: bool


class AiModelListResponse(BaseModel):
    data: list[AiModelItem]


# ---- 管理（会社モデル ON/OFF・予算・利用量・S.5） ----

class AdminModelCurrentMonth(BaseModel):
    tokens: int
    cost_micros: int


class AdminModelItem(BaseModel):
    key: str
    billing: str
    label: str          # 表示名（registry 由来・ピッカーと同一ソース・設計§9.2）
    description: str     # 用途説明（registry 由来）
    enabled: bool
    monthly_budget_micros: int | None = None
    max_output_tokens: int | None = None   # 会社別の生成トークン上限（NULL=無制限・S.5）
    current_month: AdminModelCurrentMonth


class AdminModelListResponse(BaseModel):
    data: list[AdminModelItem]


class AdminModelPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    monthly_budget_micros: int | None = None
    max_output_tokens: int | None = None   # 会社別の生成トークン上限（NULL=無制限・S.5）


class AiUsageRow(BaseModel):
    period_ym: int
    model_key: str
    input_tokens: int
    output_tokens: int
    cost_micros: int
    count: int


class AiUsageResponse(BaseModel):
    data: list[AiUsageRow]


class AiPolicyResponse(BaseModel):
    """会社の AI 動作ポリシー（S.5b・§5.67）。"""

    auto_evaluate_on_publish: bool | None   # 会社の生値（null=デプロイ既定を継承）
    effective: bool                          # coalesce(会社値, deploy_default)
    deploy_default: bool                     # env `llm_auto_evaluate_on_publish`（UI 注記用）


class AiPolicyPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_evaluate_on_publish: bool | None = Field(...)  # null=継承リセット（必須＝省略は 422）
