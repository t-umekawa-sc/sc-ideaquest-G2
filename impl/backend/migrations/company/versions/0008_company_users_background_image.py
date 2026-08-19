"""company: users に background_image_path（背景画像・MinIO キー）を追加（データモデル §5.3・K.4）

プロフィール画像（`avatar_image_path`・0001 で既存）と対で、コンテンツ背景画像のオブジェクトキーを保持。
identity ではないため outbox は経由せず会社DB 直接更新（API設計 K.4）。

Revision ID: 0008_company_users_bg_image
Revises: 0007_company_activities
Create Date: 2026-08-19

（注: alembic_version は varchar(32)＝revision は32文字以内に収める。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_company_users_bg_image"
down_revision = "0007_company_activities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("background_image_path", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "background_image_path")
