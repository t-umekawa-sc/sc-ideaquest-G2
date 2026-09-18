"""control: 業務通知メールの会社トグルを追加（companies.notify_email_enabled）

参加リクエスト等の業務通知メールを会社単位で ON/OFF する（既定 true＝送る）。SC-92 会社設定で編集。
セキュリティ系メール（PW/新端末/ロック・A.9-⑧）は本トグルの対象外＝常時送信。

Revision ID: 0016_company_notify_email
Revises: 0015_game_mode
Create Date: 2026-09-18

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_company_notify_email"
down_revision = "0015_game_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("notify_email_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("companies", "notify_email_enabled")
