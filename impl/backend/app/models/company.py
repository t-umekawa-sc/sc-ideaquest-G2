"""会社DB（テナントプレーン）のモデル。

ログインスライスに必要な users ミラー最小列（データモデル §5.3 の部分集合）。
display_name/locale は accounts のミラー（源泉=accounts・§1.13）。残高は会社DB 所有。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class CompanyBase(DeclarativeBase):
    pass


class User(CompanyBase):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 管理DB accounts.id への論理参照（会社を跨ぐため物理FKは張らない）
    account_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)  # accounts のミラー
    avatar_image_path: Mapped[str | None] = mapped_column(String(512), nullable=True)  # MinIO キー（生パス）
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ja")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    level: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    xp: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    coin_balance: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    skill_point_balance: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
