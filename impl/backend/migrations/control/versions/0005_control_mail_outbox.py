"""control: mail_outbox（認証系メールの非同期送信アウトボックス・データモデル §4.7・ADR-0007）

application 層が SMTP を叩かず 1 行 INSERT（enqueue）し、別プロセスのメールワーカ（mail_worker.py）が
取り出して SMTP 送信する。取り出しは seq（挿入順の単調増加）昇順。秘匿値は secret 列に隔離し送信後 NULL 化。

Revision ID: 0005_control_mail_outbox
Revises: 0004_control_account_sync_outbox
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0005_control_mail_outbox"
down_revision = "0004_control_account_sync_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_outbox",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("seq", sa.BigInteger(), sa.Identity(), nullable=False, unique=True),
        sa.Column("to_email", sa.String(320), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("locale", sa.String(8), nullable=True),
        sa.Column("secret", sa.Text(), nullable=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_mail_outbox_status_seq", "mail_outbox", ["status", "seq"])
    op.create_index("ix_mail_outbox_account", "mail_outbox", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_mail_outbox_account", table_name="mail_outbox")
    op.drop_index("ix_mail_outbox_status_seq", table_name="mail_outbox")
    op.drop_table("mail_outbox")
