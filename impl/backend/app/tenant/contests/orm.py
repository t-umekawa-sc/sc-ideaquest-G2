"""会社DB（テナントプレーン）のアイデアコンテスト段モデル（データモデル §5.60-5.64・FR-46/47）。

**アーキの芯＝クエストを器に再利用**（設計 §2）＝`contests.quest_id` が backing クエストを 1:1 で指し、
アイデア/投票/評価/チャット/ランキングは既存機構を無改修で共有。本モジュールはコンテスト固有の差分
（枠・会期・参加2階層・殿堂入り/お蔵入り）だけを持つ。②会社レベル能力は `capabilities/orm.py`。

enum（mode/status/flag 等）は §5.3 と同方針で DB enum 型を使わず Text で持つ。呼び出し側 Tx に相乗。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Contest(CompanyBase):
    __tablename__ = "contests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False, unique=True)
    mode: Mapped[str] = mapped_column(Text, nullable=False, default="bounded", server_default="bounded")  # bounded|rolling
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft", server_default="draft")  # draft|open|judging|closed|archived
    theme: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_archive_days: Mapped[int | None] = mapped_column(Integer, nullable=True)   # rolling の自動お蔵入り日数
    # Tier1 参加の自動承認（FR-46）。true＝社内でも申請なしで即 approved（オープン参加）。既定 false＝管理者承認制。
    auto_approve: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    prize_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)         # 表彰軸と上位N・付与XP/コイン・実績（§6.3）
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ContestParticipant(CompanyBase):
    """Tier1：コンテスト参加（閲覧＋自分のアイデア投稿＋投票）。承認=管理者（public/DEMO は自動 approved）。"""
    __tablename__ = "contest_participants"
    __table_args__ = (UniqueConstraint("contest_id", "user_id", name="uq_contest_participant"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contests.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="requested", server_default="requested")  # requested|approved|rejected|left
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class IdeaParticipant(CompanyBase):
    """Tier2：個別アイデア参加（チャット）。承認=そのアイデアの投稿者（心理的安全性）。"""
    __tablename__ = "idea_participants"
    __table_args__ = (UniqueConstraint("idea_id", "user_id", name="uq_idea_participant"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="requested", server_default="requested")
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # ＝投稿者


class ContestIdeaFlag(CompanyBase):
    """アイデアの恒久ステータス（殿堂入り/お蔵入り）＝ideas 無改修のため外付け（決定B）。入賞は既存 is_selected 流用。"""
    __tablename__ = "contest_idea_flags"
    __table_args__ = (UniqueConstraint("idea_id", "flag", name="uq_contest_idea_flag"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    contest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("contests.id"), nullable=False)
    flag: Mapped[str] = mapped_column(Text, nullable=False)  # shelved | hall_of_fame
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
