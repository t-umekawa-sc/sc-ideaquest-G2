"""control: trusted_devices（信頼端末・iq_trust・ADR-0004 §2.3）

MFA をスキップしてよい端末の登録。token_hash＝iq_trust の SHA-256（平文は保存しない）。
login で「未失効かつ未期限切れ」を照合、logout-all で全端末を revoked にする（A.0-⑤）。

Revision ID: 0003_control_trusted_devices
Revises: 0002_control_otp_challenges
Create Date: 2026-08-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0003_control_trusted_devices"
down_revision = "0002_control_otp_challenges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trusted_devices",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("token_hash", sa.String(128), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_trusted_devices_account", "trusted_devices", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_trusted_devices_account", table_name="trusted_devices")
    op.drop_table("trusted_devices")
