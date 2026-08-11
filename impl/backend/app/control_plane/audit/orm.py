"""システム監査ログ（管理DB・データモデル §4.5・API設計 B.6）。append-only。"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ControlBase


class SystemAuditLog(ControlBase):
    __tablename__ = "system_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 実行者。利用者を伴わない処理（bootstrap/program）は NULL（§4 監査規約）。
    actor_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)  # 例: account.disable / company.settings_update
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # 対象/前後（機密は入れない・§15）
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 確定 IP（ADR-0006）
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
