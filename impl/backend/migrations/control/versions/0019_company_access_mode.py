"""control: 会社の公開/非公開モード＋セルフサインアップ許可（companies・FR-48・設計 §8）。

access_mode（private/public）＝authz/メニュー/導線の権威。self_signup_enabled＝公開サインアップの opt-in。
いずれも既定は安全側（private / false）。

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内。）

Revision ID: 0019_company_access_mode
Revises: 0018_alignment_method
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_company_access_mode"
down_revision = "0018_alignment_method"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("access_mode", sa.String(length=16), nullable=False,
                                         server_default="private"))
    op.add_column("companies", sa.Column("self_signup_enabled", sa.Boolean(), nullable=False,
                                         server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("companies", "self_signup_enabled")
    op.drop_column("companies", "access_mode")
