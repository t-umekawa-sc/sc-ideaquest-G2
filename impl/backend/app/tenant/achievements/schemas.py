"""ドメイン G（実績）の API DTO（§3.2・G.4）。シークレット未獲得は伏せる（多くが Optional）。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AchievementProgress(BaseModel):
    current: int = 0
    target: int | None = None


class AchievementDTO(BaseModel):
    id: str
    unlocked: bool = False
    is_secret: bool = False
    tier: str | None = None
    category: str | None = None
    code: str | None = None
    icon: str | None = None
    name: str | None = None
    description: str | None = None
    condition_label: str | None = None
    coin_reward: int = 0
    unlocked_at: datetime | None = None
    progress: AchievementProgress = AchievementProgress()


class AchievementSummary(BaseModel):
    unlocked: int = 0
    total: int = 0
    coin_earned: int = 0


class AchievementListResponse(BaseModel):
    data: list[AchievementDTO]
    summary: AchievementSummary


class MyAchievementDTO(BaseModel):
    achievement_id: str
    code: str
    tier: str
    unlocked_at: datetime | None = None
    progress_current: int = 0
    progress_target: int | None = None


class MyAchievementsResponse(BaseModel):
    data: list[MyAchievementDTO]
