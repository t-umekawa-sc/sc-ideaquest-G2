"""会社DB 実績マスタ・獲得実績の ORM（§5.28/§5.29・ドメイン G 実績）。

enum（achievement_tier）は String 列。condition は jsonb（判定ロジック定義）。獲得は台帳フックでサーバー判定・冪等。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Achievement(CompanyBase):
    __tablename__ = "achievements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)  # bronze/silver/gold
    icon: Mapped[str] = mapped_column(Text, nullable=False)
    name_ja: Mapped[str] = mapped_column(Text, nullable=False)
    name_en: Mapped[str] = mapped_column(Text, nullable=False)
    description_ja: Mapped[str] = mapped_column(Text, nullable=False)
    description_en: Mapped[str] = mapped_column(Text, nullable=False)
    condition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    target_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_secret: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    coin_reward: Mapped[int] = mapped_column(Integer, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class UserAchievement(CompanyBase):
    __tablename__ = "user_achievements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    achievement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("achievements.id"), nullable=False)
    progress_current: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    progress_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
