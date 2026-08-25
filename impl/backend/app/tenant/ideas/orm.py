"""会社DB（テナントプレーン）のアイデア系モデル（データモデル §5.10〜§5.14・§5.23）。

- `ideas`＝アイデア本体（`author_id`＝投稿者・§5.10）。論理削除は `deleted_at`＋`deleted_by_id`。
- `idea_stakeholders`＝利害関係者（複数可・`UNIQUE(idea_id, label)`・§5.11）。置換セット運用。
- `attachments`＝添付（アイデア or チャットメッセージ・§5.12）。実体は MinIO（`object_key`）。
- `votes`＝投票（`UNIQUE(idea_id, user_id)`＝1人1票・§5.13）。表示の記名/匿名は会社設定に従う（データは常に保持）。
- `idea_revisions`＝版（編集ごとに1版・`changes` は版スナップショット jsonb・`UNIQUE(idea_id, revision)`・§5.14）。
- `follows`＝アイデアフォロー（`UNIQUE(user_id, idea_id)`・§5.23）。

enum（`idea_status`/`vote_type`）は §5.3 と同方針で String で持つ（DB enum 型は使わない）。呼び出し側 Tx に相乗する
repository と組み合わせる（自身では commit しない・quests と同方針）。
**注記**: `attachments.chat_message_id` は E ドメイン（`chat_messages`）未作成のため現段階は FK なしの UUID 列。
E の migration で FK を張る（idea 添付は `idea_id` のみで機能する）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Idea(CompanyBase):
    __tablename__ = "ideas"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    time_limit: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # idea_status（draft/published・§3）。会社DBでも String で持つ。
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    # 選定フラグ（採用＝XP200/選定通知・F/G）。
    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 現在の版番号（idea_revisions と対応・編集で +1）。
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # 論理削除（トゥームストーン）。NULL＝有効。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class IdeaStakeholder(CompanyBase):
    __tablename__ = "idea_stakeholders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    # 事前定義値 or 自由入力の正規化後（トリム＋大小文字/全半角正規化は application・§5.11）。
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class Attachment(CompanyBase):
    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # アイデア添付のとき idea_id、チャット添付のとき chat_message_id（どちらか一方・CHECK は migration）。
    idea_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=True)
    # E ドメイン（chat_messages）未作成のため現段階は FK なし（E migration で FK を張る）。
    chat_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)  # MinIO 物理名（ハッシュ）
    original_name: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Vote(CompanyBase):
    __tablename__ = "votes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # vote_type（approve/oppose・§3）。会社DBでも String で持つ。
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    # 投票時点の版（陳腐化判定＝voted_revision < ideas.current_revision で「更新前に投票」）。
    voted_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    voted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class IdeaRevision(CompanyBase):
    __tablename__ = "idea_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    editor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # 版スナップショット（対象フィールド全値・§8-⑤）。差分は表示時に前版と比較して算出。
    changes: Mapped[dict] = mapped_column(JSONB, nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 版の記録日時（版タイムラインの表示・更新マーカー元データ・§5.14／D.4 line44/98）。
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Follow(CompanyBase):
    __tablename__ = "follows"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    idea_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ideas.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
