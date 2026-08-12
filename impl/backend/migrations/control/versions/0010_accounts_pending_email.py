"""control: accounts.pending_email 列を追加（メール変更ダブルオプトインの確定待ち新メール）

メール変更（ドメイン K・`POST /me/email`）を確認リンク（`otp_challenges.purpose=email_change`）到達で
確定するダブルオプトイン（ADR-0008）の pending 保持列。NULL 可（未確認は NULL）。**一意制約は付けない**
（確定時＝`POST /me/email/confirm` で会社内一意を再検証＝first-confirm-wins・データモデル §4.2）。

Revision ID: 0010_accounts_pending_email
Revises: 0009_control_audit_logs
Create Date: 2026-08-12

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_accounts_pending_email"
down_revision = "0009_control_audit_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("pending_email", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "pending_email")
