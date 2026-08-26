"""control: mail_outbox.params 列を追加（非秘匿の描画パラメータ）

セキュリティ通知メール（new_device＝ip/device/at）の本文レンダリングに使う非秘匿値を保持する。
秘匿値（OTP/トークン）は従来通り `secret` に隔離（送信後 NULL 化）し、`params` は描画専用で残す。
password_changed メールは固定文＝params 不要（NULL）。

Revision ID: 0012_mail_outbox_params
Revises: 0011_accounts_email_verified
Create Date: 2026-08-26

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0012_mail_outbox_params"
down_revision = "0011_accounts_email_verified"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mail_outbox", sa.Column("params", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("mail_outbox", "params")
