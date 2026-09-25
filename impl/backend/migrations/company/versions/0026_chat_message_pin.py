"""company: チャットメッセージのピン留め（FR-39 (b) 議論の要点＝重要メッセージ）

クエスト最終結果の「議論の要点」に集約する重要メッセージを、owner/quest_admin がピン留めできる。
検証の証跡（なぜ有望と判断したか）を残す（ISO56001）。既定 false・pinned_by/pinned_at は監査。

Revision ID: 0026_chat_message_pin
Revises: 0025_quest_outcomes
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0026_chat_message_pin"
down_revision = "0025_quest_outcomes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("chat_messages", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("chat_messages", sa.Column("pinned_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "pinned_by")
    op.drop_column("chat_messages", "pinned_at")
    op.drop_column("chat_messages", "is_pinned")
