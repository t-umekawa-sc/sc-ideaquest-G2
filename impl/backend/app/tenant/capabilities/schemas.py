"""②会社レベル能力（user_capabilities）の DTO（API設計 T.4）。"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CapabilityListResponse(BaseModel):
    capabilities: list[str]  # 当該ユーザーの有効な能力名（info_curator/quest_create/contest_create/contest_evaluator）


class CapabilityGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability: str = Field(min_length=1, max_length=64)
