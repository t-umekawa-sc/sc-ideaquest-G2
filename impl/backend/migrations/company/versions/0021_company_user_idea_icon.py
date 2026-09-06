"""company: users.idea_icon_image_path 列を追加（アイデア用アイコンの既定・デザイン標準「アイデアアイコン」Phase 2）

その人が作るアイデアの共通マーク（アバターとは別）を会社 DB の users に保持する。MinIO オブジェクトキー（生パス）を
持ち、応答は短TTL 署名URL に解決（K.4 流儀）。nullable（未設定＝件名先頭1文字タイルにフォールバック）。
会社 DB 単独列＝管理 DB からのミラー対象外。

Revision ID: 0021_company_user_idea_icon
Revises: 0020_company_balance_guards
Create Date: 2026-09-06

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0021_company_user_idea_icon"
down_revision = "0020_company_balance_guards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("idea_icon_image_path", sa.String(512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "idea_icon_image_path")
