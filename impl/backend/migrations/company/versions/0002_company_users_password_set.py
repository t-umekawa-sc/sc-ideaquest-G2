"""company: users.password_set 列を追加（accounts.password_set のミラー・データモデル §4.6/§5.3）

初回PW設定完了（A.7 complete）で accounts.password_set→users へ outbox 反映するための受け皿。
既存行は false（未設定）で作成し、ミラーで更新される。

Revision ID: 0002_company_users_password_set
Revises: 0001_company_init
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_company_users_password_set"
down_revision = "0001_company_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_set", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "password_set")
