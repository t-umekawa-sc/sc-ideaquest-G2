"""会社DB（テナントプレーン）の②会社レベル能力の単一レジストリ（データモデル §5.63・FR-47）。

会社内でその行為ができるか（会社横断）を表す②層の能力台帳。付与=system_admin/company_account_admin、
論理剥奪（行は残す＝監査）。**既存 info_curators（§5.37）を本表へ統合**する方針（`capability='info_curator'`）＝
1能力1テーブルの増殖を止め付与/剥奪/管理UI/監査を1本化（DRY）。統合の実データ移行は別ステップ（ドメインN
参照差し替えを伴うため慎重に）＝本モジュールは新規テーブルの ORM のみ。

有効な付与は能力ごと1行＝partial unique index `uq_user_capability_active (user_id, capability) WHERE revoked_at IS NULL`
（migration 0050・`info_curators` の `UNIQUE(user_id) WHERE revoked_at IS NULL` を一般化）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import CompanyBase

# 能力の語彙（§5.63）。info_curator は既存 info_curators の統合先（移行は別ステップ）。
CAPABILITIES = ("info_curator", "quest_create", "contest_create", "contest_evaluator")


class UserCapability(CompanyBase):
    __tablename__ = "user_capabilities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    capability: Mapped[str] = mapped_column(Text, nullable=False)  # info_curator|quest_create|contest_create|contest_evaluator
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # 論理剥奪（監査保持）
