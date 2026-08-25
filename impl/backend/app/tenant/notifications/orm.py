"""会社DB 通知の ORM（§5.24・ドメイン H）。

本文は取得時レンダリング（§8-⑳）＝`body` は既定ロケールのフォールバック（NULL 可）・可変値は `params`（jsonb）に凍結。
enum（notification_type）は String 列（§5.3 方針）。参照は種別により NULL 可。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Notification(CompanyBase):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    ref_idea_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=True)
    ref_chat_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_messages.id"), nullable=True)
    ref_idea_revision_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("idea_revisions.id"), nullable=True)
    ref_achievement_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("achievements.id"), nullable=True)
    ref_quest_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=True)
    params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
