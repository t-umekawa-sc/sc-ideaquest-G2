"""アイデアコンテストの DTO（API設計 T.1）。公開性は会社設定 `access_mode` 一本化＝visibility は持たない。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ContestCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: str = Field(min_length=1, max_length=255)
    description: str | None = None
    mode: str = "bounded"            # bounded | rolling
    status: str = "draft"            # 作成時は draft か即 open（以降は PATCH で前進）
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_archive_days: int | None = None
    prize_config: dict | None = None


class ContestUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    theme: str | None = None
    description: str | None = None
    status: str | None = None        # 状態遷移（前進のみ・draft→open→judging→closed→archived）
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_archive_days: int | None = None
    prize_config: dict | None = None


class ContestListItem(BaseModel):
    id: str
    mode: str
    status: str
    theme: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    created_at: datetime


class ContestListResponse(BaseModel):
    data: list[ContestListItem]


class ParticipationResponse(BaseModel):
    status: str  # requested | approved | rejected | left


class ParticipationDecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern="^(approved|rejected)$")


class ContestDetail(BaseModel):
    id: str
    quest_id: str                    # backing quest（アイデア/投票/評価/チャットの接続先）
    mode: str
    status: str
    theme: str
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_archive_days: int | None = None
    prize_config: dict | None = None
    created_at: datetime
    idea_count: int = 0
