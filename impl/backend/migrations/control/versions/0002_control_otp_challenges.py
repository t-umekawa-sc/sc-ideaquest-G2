"""control: otp_challenges（OTP チャレンジ・データモデル §4.4）

本スライスは purpose=password_setup（初回/再設定リンク・72h・単回・ADR-0002）を利用する。
login（6桁OTP）は同テーブルを MFA スライスで purpose=login として使う。

Revision ID: 0002_control_otp_challenges
Revises: 0001_control_init
Create Date: 2026-08-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0002_control_otp_challenges"
down_revision = "0001_control_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "otp_challenges",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("code_hash", sa.String(128), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),  # login | password_setup
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_otp_challenges_account_purpose", "otp_challenges", ["account_id", "purpose"])


def downgrade() -> None:
    op.drop_index("ix_otp_challenges_account_purpose", table_name="otp_challenges")
    op.drop_table("otp_challenges")
