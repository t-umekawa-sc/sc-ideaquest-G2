"""company: users.last_login_at 列を追加（accounts.last_login_at のミラー・データモデル §4.6/§5.3）

ログイン成功で accounts.last_login_at→users へ outbox 反映するための受け皿。NULL 可（未ログインは NULL）。

Revision ID: 0003_company_last_login_at
Revises: 0002_company_users_password_set
Create Date: 2026-08-11

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_company_last_login_at"
down_revision = "0002_company_users_password_set"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_login_at")
