"""会社DB 評価・観点スコアの ORM（§5.21/§5.22・ドメイン F）。

- `evaluations`＝1アイデア×評価者1人1評価（`UNIQUE(idea_id, evaluator_id)`）・draft/submitted・party/limited。
- `evaluation_scores`＝5観点（novelty/impact/feasibility/fit/cost）×1..5（`UNIQUE(evaluation_id, aspect)`）。
- enum（evaluation_status/evaluation_visibility/evaluation_aspect）は §5.3 と同方針で String 列で持つ。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Evaluation(CompanyBase):
    __tablename__ = "evaluations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    evaluator_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    overall_comment: Mapped[str | None] = mapped_column(Text, nullable=True)  # 確定時必須／下書きは空可
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    visibility: Mapped[str] = mapped_column(String(16), nullable=False, default="party", server_default="party")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # XP/コイン付与の起点


class EvaluationScore(CompanyBase):
    __tablename__ = "evaluation_scores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    evaluation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("evaluations.id"), nullable=False)
    aspect: Mapped[str] = mapped_column(String(16), nullable=False)  # novelty/impact/feasibility/fit/cost
    score: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..5（cost は低コストほど高得点）
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)  # 観点別コメント（任意）
