"""会社DB（テナントプレーン）の お知らせ モデル（データモデル §5.65/5.66・FR-49）。

全社お知らせ（管理者投稿・全ユーザー閲覧）。本文リッチテキストは **PM-JSON（TipTap）を `body` に保存**（正本）、
保存時 `app/core/richtext.sanitize_pm` で無害化し、`body_html`＝`pm_to_html`（表示用）・`body_text`＝`pm_to_text`
（検索/抜粋用）を**派生**として併置する。既読は `announcement_reads`（冪等）。通知（H）連携なし。
enum（status）は DB enum を使わず Text で持つ（§5.3 と同方針）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Announcement(CompanyBase):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{\"type\":\"doc\",\"content\":[]}'::jsonb"))  # PM-JSON 正本
    body_html: Mapped[str] = mapped_column(Text, nullable=False)   # pm_to_html(body) の派生（表示用・サニタイズ済）
    body_text: Mapped[str] = mapped_column(Text, nullable=False)   # pm_to_text(body) の派生（全文検索/抜粋用）
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft", server_default="draft")  # draft|published|archived
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class AnnouncementRead(CompanyBase):
    __tablename__ = "announcement_reads"
    __table_args__ = (UniqueConstraint("announcement_id", "user_id", name="uq_announcement_reads"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    announcement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("announcements.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
