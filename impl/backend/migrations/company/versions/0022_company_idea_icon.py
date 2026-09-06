"""company: ideas.icon_image_path 列を追加（アイデア個別アイコン・デザイン標準「アイデアアイコン」Phase 3）

アイデアごとに任意でカスタムアイコンを設定できる（未設定＝作成者の既定アイデアアイコン→件名先頭1文字タイル）。
MinIO オブジェクトキー（生パス）を持ち、応答は短TTL 署名URL に解決（K.4 流儀）。nullable。会社 DB 単独列。

Revision ID: 0022_company_idea_icon
Revises: 0021_company_user_idea_icon
Create Date: 2026-09-06

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_company_idea_icon"
down_revision = "0021_company_user_idea_icon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ideas",
        sa.Column("icon_image_path", sa.String(512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ideas", "icon_image_path")
