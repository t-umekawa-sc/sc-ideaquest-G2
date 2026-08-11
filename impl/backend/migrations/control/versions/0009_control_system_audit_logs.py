"""control: system_audit_logs（システム監査ログ）を作成（データモデル §4.5・API設計 B.6）

特権操作（会社/アカウント/グループ/所属）の監査。append-only。actor は NULL 可（program/bootstrap）。

Revision ID: 0009_control_audit_logs
Revises: 0008_companies_settings
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0009_control_audit_logs"
down_revision = "0008_companies_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("detail", JSONB, nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_system_audit_logs_actor", "system_audit_logs", ["actor_account_id"])
    op.create_index("ix_system_audit_logs_action", "system_audit_logs", ["action"])
    op.create_index("ix_system_audit_logs_created_at", "system_audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_system_audit_logs_created_at", table_name="system_audit_logs")
    op.drop_index("ix_system_audit_logs_action", table_name="system_audit_logs")
    op.drop_index("ix_system_audit_logs_actor", table_name="system_audit_logs")
    op.drop_table("system_audit_logs")
