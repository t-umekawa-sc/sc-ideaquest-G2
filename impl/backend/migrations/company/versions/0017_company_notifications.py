"""company: notifications を作成（§5.24・ドメイン H 通知）

本文は取得時レンダリング（§8-⑳）＝`body` は既定ロケールのフォールバック（NULL 可）・`params jsonb` に可変値
（actor_name/revision/tier/coin/security の device/ip/at 等）をイベント時点でスナップショット。enum（notification_type）
は §5.3 と同方針で String 列。参照は種別により NULL 可（idea/chat_message/idea_revision/achievement/quest）。

Revision ID: 0017_company_notifications
Revises: 0016_company_achievements
Create Date: 2026-08-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0017_company_notifications"
down_revision = "0016_company_achievements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("recipient_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),  # notification_type（§3）
        sa.Column("ref_idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=True),
        sa.Column("ref_chat_message_id", UUID(as_uuid=True), sa.ForeignKey("chat_messages.id"), nullable=True),
        sa.Column("ref_idea_revision_id", UUID(as_uuid=True), sa.ForeignKey("idea_revisions.id"), nullable=True),
        sa.Column("ref_achievement_id", UUID(as_uuid=True), sa.ForeignKey("achievements.id"), nullable=True),
        sa.Column("ref_quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=True),
        sa.Column("params", JSONB(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 一覧（新着降順）＋未読集計のためのインデックス（§5.24）。
    op.create_index("ix_notifications_recipient", "notifications", ["recipient_id", "is_read", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_notifications_recipient", table_name="notifications")
    op.drop_table("notifications")
