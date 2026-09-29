"""control: 経営資料整合の類似度方式を会社単位で設定（companies.alignment_method）

整合率（アイデア↔経営資料・FR-44）の類似度を keyword=キーワード一致／embedding=意味（埋め込み・A-2）／
hybrid=両者の加重、から会社単位で選べるようにする。既定 keyword（検証後に切替）。SC-92 会社設定で編集。

Revision ID: 0018_alignment_method
Revises: 0017_autolink_threshold
Create Date: 2026-09-29

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_alignment_method"
down_revision = "0017_autolink_threshold"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("alignment_method", sa.String(16), nullable=False, server_default="keyword"),
    )


def downgrade() -> None:
    op.drop_column("companies", "alignment_method")
