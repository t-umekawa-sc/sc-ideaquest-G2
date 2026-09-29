"""会社DB（テナントプレーン）の経営資料・整合スコア モデル（データモデル §5.54-5.55・FR-44）。

- `strategy_documents`＝会社の基準文書（中長期計画/方針/戦略・ISO56001 §4/§5.2/§6 の構造化項目）。管理者のみ登録/編集。
  本文（構造化項目＋body_md 連結の `body_text`）は `entity_tokens`（owner_type='strategy_doc'・§5.36b）でトークン化し整合率に使う。
- `idea_alignment`＝アイデア×経営資料の整合率（派生キャッシュ・事前計算・`info_links.score` と同思想）。

enum（doc_kind/status/method）は §5.3 と同方針で DB enum 型を使わず String で持つ。呼び出し側 Tx に相乗（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class StrategyDocument(CompanyBase):
    __tablename__ = "strategy_documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    doc_kind: Mapped[str] = mapped_column(Text, nullable=False, default="other", server_default="other")  # midterm_plan/policy/strategy/other
    intent: Mapped[str | None] = mapped_column(Text, nullable=True)              # 意図・ビジョン（§4/§5.1）
    policy_commitment: Mapped[str | None] = mapped_column(Text, nullable=True)   # 方針・コミットメント（§5.2）
    strategy: Mapped[str | None] = mapped_column(Text, nullable=True)           # 戦略・方向性（§6.1）
    focus_areas: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list, server_default="{}")  # 重点領域
    objectives: Mapped[str | None] = mapped_column(Text, nullable=True)         # イノベーション目標（§6.2）
    body_md: Mapped[str | None] = mapped_column(Text, nullable=True)            # 補足・全文
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)          # 平文派生（トークン化/検索用）
    period_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active", server_default="active")  # active/archived
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class IdeaAlignment(CompanyBase):
    __tablename__ = "idea_alignment"
    __table_args__ = (UniqueConstraint("idea_id", "strategy_document_id", name="uq_idea_alignment"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    strategy_document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("strategy_documents.id"), nullable=False)
    score: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)       # cosine 0..1（表示は %）
    method: Mapped[str] = mapped_column(Text, nullable=False, default="keyword", server_default="keyword")  # keyword/embedding
    matched_tokens: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)  # 効いた方針トークン（keyword 時・説明用）
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
