"""会社DB（テナントプレーン）のクエスト・カテゴリ・パーティー・権限モデル（データモデル §5.6〜§5.9）。

- `quests`＝クエスト本体（`owner_id`＝作成者＝所有者・剥奪不可・§5.6）。論理削除は `deleted_at`＋`deleted_by_id`。
- `quest_categories`＝クエストカテゴリ（複数可・`UNIQUE(quest_id, label)`・§5.7）。置換セットで運用。
- `quest_members`＝パーティー（クエスト参加者・§5.8）。除外は `removed_at` トゥームストーン、
  有効参加は部分ユニーク `UNIQUE(quest_id, user_id) WHERE removed_at IS NULL`（index は migration 側）。
- `quest_member_permissions`＝参加者権限（6 権限・`UNIQUE(quest_member_id, permission)`・§5.9）。

enum（`quest_status`/`permission_type`）は §5.3 と同方針で会社DBでも String で持つ（DB enum 型は使わない）。
呼び出し側 Tx に相乗する repository と組み合わせる（自身では commit しない・quest_group と同方針）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Quest(CompanyBase):
    __tablename__ = "quests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 所属クエストグループ（作成時に確定・以後不変・C.2）。
    quest_group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("quest_groups.id"), nullable=False
    )
    # 作成者＝既定で所有者（`owner` 権限・剥奪不可・§5.6/C.0）。
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # プリセットパレット hex（既定色）。バリデーションは application 側（§C.6 入力検証）。
    color: Mapped[str] = mapped_column(String(32), nullable=False)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    # quest_status（draft/recruiting/in_progress/evaluating/completed・§3）。会社DBでも String で持つ。
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", server_default="draft")
    # MinIO キー・任意（§1.10）。未設定時は「件名頭文字＋所有者アバター」（フロント表示）。
    icon_image_path: Mapped[str | None] = mapped_column(String, nullable=True)
    # 論理削除（トゥームストーン）。NULL＝有効。値あり＝削除済み（一覧/参照から除外・§5.6）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestCategory(CompanyBase):
    __tablename__ = "quest_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    # 事前定義値 or 自由入力の正規化後（トリム＋大小文字/全半角正規化は application・§5.7）。
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    # 事前定義候補に一致しないラベルは is_custom=true（§5.7）。
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class QuestMember(CompanyBase):
    __tablename__ = "quest_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("quests.id"), nullable=False)
    # 候補は当該クエストの所属グループメンバーに限定（application で強制・§5.8/C.3）。
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    # 再追加（トゥームストーン復活）時は now() に更新＝現在の参加開始を表す（§5.8）。
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # パーティー除外の論理削除（トゥームストーン）。NULL＝有効な参加。門番/候補は removed_at IS NULL で絞る（§5.8）。
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestMemberPermission(CompanyBase):
    __tablename__ = "quest_member_permissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("quest_members.id"), nullable=False
    )
    # permission_type（6 権限・§3）。会社DBでも String で持つ。
    permission: Mapped[str] = mapped_column(String(32), nullable=False)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
