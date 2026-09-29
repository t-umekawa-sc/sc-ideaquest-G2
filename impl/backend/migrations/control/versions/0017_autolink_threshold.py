"""control: 自動関連付けの一致率しきい値を会社単位で設定（companies.auto_link_threshold）

情報インプットの自動関連付け（N.6）で「何%以上の一致率で自動リンクするか」を会社単位で調整可能にする。
既定 0.120（=12%・現行のハードコード値と同じ）。SC-92 会社設定で編集。0..1 の範囲（cosine 類似度）。

Revision ID: 0017_autolink_threshold
Revises: 0016_company_notify_email
Create Date: 2026-09-29

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_autolink_threshold"
down_revision = "0016_company_notify_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("auto_link_threshold", sa.Numeric(4, 3), nullable=False, server_default="0.120"),
    )


def downgrade() -> None:
    op.drop_column("companies", "auto_link_threshold")
