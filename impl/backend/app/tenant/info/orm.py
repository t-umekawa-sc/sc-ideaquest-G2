"""会社DB（テナントプレーン）の情報インプット モデル（データモデル §5.33-5.37・FR-41）。

- `info_items`＝情報本体（外部WEB情報の手動貼付・会社横断の知識レイヤ）。低摩擦登録＝title/body/url は
  全ユーザー（status=raw）／curated 属性・判定・アーカイブは info_curator。本文は nh3 サニタイズ済 HTML、
  `body_text` は平文派生（検索/トークン化/要約）、`summary` は抽出型要約の派生。続報は `parent_info_id` 自己参照。
- `info_item_categories`＝情報カテゴリ（#8・複数可 M:N・§5.34）。
- `info_links`＝情報↔成果物（ideas/concepts/quests/assumptions）の動的リンク（多態・関連/裏付け/反証・§5.35）。
- `info_tokens`＝本文トークン派生（janome・ワードクラウド/類似度・§5.36）。
- `info_curators`＝情報判定権限（会社/テナント単位・§5.37）。

enum（info_status/priority/... ）は §5.3 と同方針で会社DBでも String で持つ（DB enum 型は使わない）。
呼び出し側 Tx に相乗する repository と組み合わせる（自身では commit しない）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class InfoItem(CompanyBase):
    __tablename__ = "info_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 続報（follow-up）＝続報元。NULL=根。登録時に親の info_links を origin=auto でスナップショット複製（§12-1）。
    parent_info_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("info_items.id"), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[str | None] = mapped_column(Text, nullable=True)   # サニタイズ済 HTML（nh3・§12-4）
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)   # 平文派生（検索/トークン/要約）
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)     # 抽出型要約の派生（janome・§12-3）
    summary_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # http/https のみ（§7・#4）
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # info_status（raw/curated/archived・§3）。会社DBでも String で持つ。
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="raw", server_default="raw")
    priority: Mapped[str | None] = mapped_column(String(16), nullable=True)          # info_priority（#1）
    source: Mapped[str | None] = mapped_column(String(24), nullable=True)            # info_source（#2）
    classification: Mapped[str | None] = mapped_column(String(24), nullable=True)    # info_classification（#3）
    scope: Mapped[str | None] = mapped_column(String(16), nullable=True)             # info_scope（#6）
    target_business: Mapped[str | None] = mapped_column(String(32), nullable=True)   # info_target_business（#7）
    impact_level: Mapped[str | None] = mapped_column(String(16), nullable=True)      # info_impact_level（#9）
    impact_class: Mapped[str | None] = mapped_column(String(16), nullable=True)      # info_impact_class（#10）
    impact_timing: Mapped[str | None] = mapped_column(String(16), nullable=True)     # info_impact_timing（#11）
    triaged_on: Mapped[date | None] = mapped_column(Date, nullable=True)             # 情報判定日（#12）
    triage: Mapped[str | None] = mapped_column(String(24), nullable=True)            # info_triage（#13）
    triage_reason: Mapped[str | None] = mapped_column(Text, nullable=True)           # 判定理由（#14）
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 共通監査（§2.1）
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InfoItemCategory(CompanyBase):
    __tablename__ = "info_item_categories"
    __table_args__ = (UniqueConstraint("info_item_id", "category", name="uq_info_item_categories"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    info_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("info_items.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)  # info_category（§3）


class InfoLink(CompanyBase):
    __tablename__ = "info_links"
    __table_args__ = (UniqueConstraint("info_item_id", "target_type", "target_id", name="uq_info_links"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    info_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("info_items.id"), nullable=False)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False)  # ideas/concepts/quests/assumptions
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)  # 多態参照（物理 FK なし・§2.2 #4）
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="related", server_default="related")
    origin: Mapped[str] = mapped_column(String(8), nullable=False)  # auto/manual
    score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    # 棄却＝行は残す。再計算の upsert は rejected_at を尊重＝棄却済み auto は復活しない（§N.6）。
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class InfoToken(CompanyBase):
    __tablename__ = "info_tokens"
    __table_args__ = (UniqueConstraint("info_item_id", "token", name="uq_info_tokens"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    info_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("info_items.id"), nullable=False)
    token: Mapped[str] = mapped_column(Text, nullable=False)
    weight: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")


class InfoItemRevision(CompanyBase):
    """内容（title/body_html/source_url/参考資料）の版スナップショット（N.2・§12）。判定後も作成者が
    内容を編集できるため、triage 時点の内容を追跡できるよう版を残す（idea_revisions と同型）。"""
    __tablename__ = "info_item_revisions"
    __table_args__ = (UniqueConstraint("info_item_id", "revision", name="uq_info_item_revisions"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    info_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("info_items.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    editor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {title, body_html, source_url} のスナップショット
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InfoCurator(CompanyBase):
    __tablename__ = "info_curators"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
