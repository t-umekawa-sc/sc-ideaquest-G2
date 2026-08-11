"""会社DB（テナントプレーン）のクエストグループ・所属モデル（データモデル §5.4/§5.5）。

- `quest_groups`＝クエストグループ本体（`quest_group_code` は会社内一意）。
- `quest_group_members`＝ユーザー×グループ所属の**唯一の正**（§8-①・管理DB には持たない）。
  所属は物理削除せず `removed_at` トゥームストーンで解除（監査/入力保持・§5.5）。
  有効な所属は部分ユニーク `UNIQUE(quest_group_id, user_id) WHERE removed_at IS NULL`
  で重複を禁止（index は migration 側で定義）。`role` は QG管理者の唯一の表現（B案・`admin`/`member`）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class QuestGroup(CompanyBase):
    __tablename__ = "quest_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 業務上のグループ識別コード（会社内で一意・大文字正規化して保存・§5.4）。
    # 一意は「有効（deleted_at IS NULL）行のみ」の部分ユニーク（migration 0006）＝削除後の再作成を許容。
    quest_group_code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # グループ削除の論理削除（トゥームストーン）。NULL＝有効。値あり＝削除済み（一覧/候補は deleted_at IS NULL で絞る・§5.4）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestGroupMember(CompanyBase):
    __tablename__ = "quest_group_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quest_group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("quest_groups.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    # グループ内ロール（QG管理者の唯一の表現・B案）。enum 値は会社DBでも String で持つ（§5.3 system_role と同方針）。
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member", server_default="member")
    # 所属解除の論理削除（トゥームストーン）。NULL＝有効な所属。値あり＝解除済み（物理削除しない・§5.5）。
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
