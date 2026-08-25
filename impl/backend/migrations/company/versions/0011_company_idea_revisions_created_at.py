"""company: idea_revisions.created_at 列を追加（版の日時・データモデル §5.14／API設計 D.4 line44/98）

版タイムライン（SC-22 更新履歴）と議論アクティビティの更新マーカー元データに版の記録日時が要る。
§5.14 に created_at を追記（設計を正とし実装を追随）。NOT NULL・server_default now()（既存行は移行時刻で充当）。

Revision ID: 0011_company_idearev_created
Revises: 0010_company_ideas
Create Date: 2026-08-25

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_company_idearev_created"
down_revision = "0010_company_ideas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "idea_revisions",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_column("idea_revisions", "created_at")
