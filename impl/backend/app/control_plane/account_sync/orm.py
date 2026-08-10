"""管理DB（コントロールプレーン）の account_sync_outbox モデル（データモデル §4.6）。

`accounts` を会社DB `users` へ一方向ミラーするための「反映すべき仕事」の台帳。
書込側はエンドポイント処理と**同一Tx**で 1 行 INSERT し、常駐ワーカ（worker.py）が会社DB へ冪等に適用する。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ControlBase


class OutboxEntry(ControlBase):
    """`account_sync_outbox`（§4.6）。

    - `seq`＝挿入順（因果順）の単調増加キー。uuid の `id` は生成順を表さないため、取り出し/直列適用は
      `seq` 昇順で行う（データモデル §4.6 の「id（生成順）」の実体＝monotonic な seq）。
    - `op`＝`upsert`/`disable`/`enable`。`payload`＝会社DB `users` へ反映する値（`account_id` をキーに upsert）。
    - `status`＝`pending`/`done`/`failed`。`attempts`＝失敗リトライ回数（上限超で `failed`）。
    """

    __tablename__ = "account_sync_outbox"
    __table_args__ = (
        Index("ix_account_sync_outbox_status_seq", "status", "seq"),
        Index("ix_account_sync_outbox_account", "account_id"),
        Index("ix_account_sync_outbox_company_status", "company_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True, nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    op: Mapped[str] = mapped_column(String(16), nullable=False)  # upsert | disable | enable
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending|done|failed
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
