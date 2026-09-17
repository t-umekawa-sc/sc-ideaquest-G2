"""company: クエスト発見/フォロー/参加リクエスト（FR-40）

quests.discoverable 列（掲示板 SC-13 の発見公開フラグ・既定 OFF）＋quest_join_requests（参加リクエスト・
1ユーザー1行・却下非終端）＋quest_follows（watch・アイデア follows と別）を追加。enum は §5.3 と同方針で String 列。

Revision ID: 0027_quest_discovery
Revises: 0026_chat_message_pin
Create Date: 2026-09-17

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0027_quest_discovery"
down_revision = "0026_chat_message_pin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 発見公開フラグ（per-quest opt-in・既定 OFF＝現状の party-only・§5.6/FR-40）。
    op.add_column("quests", sa.Column("discoverable", sa.Boolean(), nullable=False, server_default=sa.false()))

    # 参加リクエスト（§5.8b）。1ユーザー1行＝却下を残して後日承諾（rejected→approved）。
    op.create_table(
        "quest_join_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("quest_id", "user_id", name="uq_quest_join_requests"),
    )
    op.create_index("ix_quest_join_requests_quest_status", "quest_join_requests", ["quest_id", "status"])
    op.create_index("ix_quest_join_requests_user_status", "quest_join_requests", ["user_id", "status"])

    # フォロー＝watch（§5.8c）。
    op.create_table(
        "quest_follows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("quest_id", "user_id", name="uq_quest_follows"),
    )
    op.create_index("ix_quest_follows_user", "quest_follows", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_quest_follows_user", table_name="quest_follows")
    op.drop_table("quest_follows")
    op.drop_index("ix_quest_join_requests_user_status", table_name="quest_join_requests")
    op.drop_index("ix_quest_join_requests_quest_status", table_name="quest_join_requests")
    op.drop_table("quest_join_requests")
    op.drop_column("quests", "discoverable")
