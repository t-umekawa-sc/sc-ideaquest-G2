"""control: companies に会社カラー/アイコン/投票設定フラグを追加（データモデル §4.1）

会社 CRUD（B.1・SC-91/92）に必要な列。既存 ORM は auth に最小限だったため未実装だった差分を解消。
既定＝color は既定色、vote_anonymized/hide_voters_from_managers は true（§4.1）。

Revision ID: 0008_companies_settings
Revises: 0007_accounts_email_unique
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_companies_settings"
down_revision = "0007_accounts_email_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("companies", sa.Column("color", sa.String(16), nullable=False, server_default="#6366F1"))
    op.add_column("companies", sa.Column("icon_image_path", sa.String(512), nullable=True))
    op.add_column("companies", sa.Column("vote_anonymized", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("companies", sa.Column("hide_voters_from_managers", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("companies", "hide_voters_from_managers")
    op.drop_column("companies", "vote_anonymized")
    op.drop_column("companies", "icon_image_path")
    op.drop_column("companies", "color")
