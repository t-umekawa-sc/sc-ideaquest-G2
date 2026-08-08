"""company initial: users (mirror + balances)

Revision ID: 0001_company_init
Revises:
Create Date: 2026-08-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0001_company_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("avatar_image_path", sa.String(512), nullable=True),
        sa.Column("locale", sa.String(8), nullable=False, server_default="ja"),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("level", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("xp", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("coin_balance", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("skill_point_balance", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("users")
