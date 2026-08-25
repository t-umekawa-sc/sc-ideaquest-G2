"""会社DB 装備アイテム・所有/装備の ORM（§5.25/§5.26・ドメイン G ショップ/装備）。

enum（equipment_slot/rarity）は §5.3 と同方針で String 列。所有＝UNIQUE(user_id, item_id)／同スロット1点装備は
部分ユニーク（migration 0015）で担保。アイコン（絵文字）はフロント presentation（§5.25 に icon 列なし）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase


class Item(CompanyBase):
    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name_ja: Mapped[str] = mapped_column(Text, nullable=False)
    name_en: Mapped[str] = mapped_column(Text, nullable=False)
    slot: Mapped[str] = mapped_column(String(16), nullable=False)  # head/face/body/hand/background
    rarity: Mapped[str] = mapped_column(String(16), nullable=False)  # common/standard/rare
    price_coin: Mapped[int] = mapped_column(Integer, nullable=False)
    part_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class UserItem(CompanyBase):
    __tablename__ = "user_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), nullable=False)
    slot: Mapped[str] = mapped_column(String(16), nullable=False)  # items.slot の非正規化コピー
    is_equipped: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
