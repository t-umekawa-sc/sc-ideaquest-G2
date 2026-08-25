"""company: chat_message_quotes（引用返信・複数可）を新設し、chat_messages.reply_to_message_id を撤去
（§5.16b・SC-24 §3 複数引用 決定 2026-08-18／API設計 E.1/E.2）

旧 単一 reply_to_message_id では 1 メッセージ 1 引用に限られるため、複数引用を結合テーブルで表す。

Revision ID: 0014_company_chat_quotes
Revises: 0013_company_chat
Create Date: 2026-08-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0014_company_chat_quotes"
down_revision = "0013_company_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_message_quotes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("chat_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=False),
        sa.Column("quoted_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=False),
    )
    op.create_index("uq_chat_message_quotes", "chat_message_quotes", ["chat_message_id", "quoted_message_id"], unique=True)
    op.create_index("ix_chat_message_quotes_msg", "chat_message_quotes", ["chat_message_id"])
    op.drop_column("chat_messages", "reply_to_message_id")


def downgrade() -> None:
    op.add_column("chat_messages", sa.Column("reply_to_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=True))
    op.drop_table("chat_message_quotes")
