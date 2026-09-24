"""company: info_links に採否（disposition）列を追加（§5.35・FR-41 Phase2）

成果物側の管理権限者が貼られた各リンクを「未処理/採用/不採用」で採否し、処理メモを残す。
disposition が pending 以外の間はリンクをロック（棄却/棄却解除/種別変更を 409）。
既存行は既定 pending（未処理）。

Revision ID: 0032_info_link_disposition
Revises: 0031_info_link_created_by
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0032_info_link_disposition"
down_revision = "0031_info_link_created_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("info_links", sa.Column("disposition", sa.String(length=16), nullable=False, server_default="pending"))
    op.add_column("info_links", sa.Column("disposition_note", sa.Text(), nullable=True))
    op.add_column("info_links", sa.Column("disposed_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("info_links", sa.Column("disposed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_info_links_disposed_by", "info_links", "users", ["disposed_by_id"], ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_info_links_disposed_by", "info_links", type_="foreignkey")
    op.drop_column("info_links", "disposed_at")
    op.drop_column("info_links", "disposed_by_id")
    op.drop_column("info_links", "disposition_note")
    op.drop_column("info_links", "disposition")
