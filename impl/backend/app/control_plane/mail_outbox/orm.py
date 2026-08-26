"""管理DB（コントロールプレーン）の mail_outbox モデル（データモデル §4.7・ADR-0007）。

認証系メール（OTP／設定リンク／ロック通知）を非同期送信するためのアウトボックス。
application 層は SMTP を叩かず本テーブルへ 1 行 INSERT（enqueue）して即応答し、
別プロセスのメールワーカ（mail_worker.py）が取り出して SMTP 送信する。§4.6 account_sync_outbox と
型は同じだが、DB ミラーではなくメール送信で会社 DB を跨がない。

物理型は account_sync_outbox に倣い String（論理 enum・データモデル §3 の「text + CHECK 推奨」）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ControlBase


class MailOutboxEntry(ControlBase):
    """`mail_outbox`（§4.7）。

    - `seq`＝挿入順（安定取り出し順）の単調増加キー。uuid `id` は生成順を表さないため取り出しは `seq` 昇順。
    - `category`＝`otp`/`password_setup`/`lock_notification`（送信時のテンプレ選択）。
    - `secret`＝OTP コード／設定リンクのトークンを単独保持（`lock_notification` は NULL）。
      **完成本文は保存せず**、件名/本文はワーカが送信時にレンダリングする（ADR-0007 §2.7）。
      **送信成功／端末失敗で NULL 化**して at-rest を最小化する。
    - `status`＝`pending`/`sending`/`done`/`failed`。`sending` は送信中の確保（重複緩和・§2.5）。
    - `account_id`/`company_id`＝監視/相関用（任意）。送信自体は依存しない。
    """

    __tablename__ = "mail_outbox"
    __table_args__ = (
        Index("ix_mail_outbox_status_seq", "status", "seq"),
        Index("ix_mail_outbox_account", "account_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True, nullable=False)
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)  # otp|password_setup|lock_notification
    locale: Mapped[str | None] = mapped_column(String(8), nullable=True)
    secret: Mapped[str | None] = mapped_column(Text, nullable=True)  # 送信後 NULL 化
    # 非秘匿の描画パラメータ（例＝new_device の ip/device/at）。secret と分離＝秘匿は secret のみ（NULL 化対象）
    params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=True
    )
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending|sending|done|failed
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
