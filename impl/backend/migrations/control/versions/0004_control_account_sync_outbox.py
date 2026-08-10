"""control: account_sync_outbox（管理DB→会社DB users ミラーのアウトボックス・データモデル §4.6）

accounts 更新と同一Tx で 1 行 INSERT し、常駐ワーカ（worker.py）が会社DB users へ冪等に適用する。
取り出し/直列適用は seq（挿入順の単調増加）昇順。

Revision ID: 0004_control_account_sync_outbox
Revises: 0003_control_trusted_devices
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0004_control_account_sync_outbox"
down_revision = "0003_control_trusted_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_sync_outbox",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(), nullable=False, unique=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("op", sa.String(16), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_account_sync_outbox_status_seq", "account_sync_outbox", ["status", "seq"])
    op.create_index("ix_account_sync_outbox_account", "account_sync_outbox", ["account_id"])
    op.create_index("ix_account_sync_outbox_company_status", "account_sync_outbox", ["company_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_account_sync_outbox_company_status", table_name="account_sync_outbox")
    op.drop_index("ix_account_sync_outbox_account", table_name="account_sync_outbox")
    op.drop_index("ix_account_sync_outbox_status_seq", table_name="account_sync_outbox")
    op.drop_table("account_sync_outbox")
