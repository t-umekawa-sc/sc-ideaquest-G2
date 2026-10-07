"""②会社レベル能力（user_capabilities）の DTO（API設計 T.4）。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CapabilityListResponse(BaseModel):
    capabilities: list[str]  # 当該ユーザーの有効な能力名（info_curator/quest_create/contest_create/contest_evaluator）


class CapabilityGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability: str = Field(min_length=1, max_length=64)


class CapabilityHolderDTO(BaseModel):
    """能力保有者の1行（汎用付与UI・SC-93）＝account_id で識別＋付与者名/付与日時（旧 info_curator と同形）。"""
    account_id: str
    display_name: str
    granted_by: str | None = None
    granted_at: datetime


class CapabilityHoldersResponse(BaseModel):
    data: list[CapabilityHolderDTO]
