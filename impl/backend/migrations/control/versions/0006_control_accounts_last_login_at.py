"""control: accounts.last_login_at 列を追加（源泉・ログイン成功時に更新・データモデル §4.2/§4.6）

会社DB users.last_login_at へ §4.6 outbox でミラーするための源泉列。NULL 可（未ログインは NULL）。

Revision ID: 0006_control_last_login_at
Revises: 0005_control_mail_outbox
Create Date: 2026-08-11

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_control_last_login_at"
down_revision = "0005_control_mail_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "last_login_at")
