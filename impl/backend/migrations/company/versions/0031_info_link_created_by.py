"""company: info_links に created_by_id（手動で関連付けた人）を追加（§5.35・FR-41）

手動リンク（origin=manual）を「誰が関連付けたか」を追える監査列。成果物側の関連情報パネル
（C.8b／D＝GET /{quest,idea}/related-info）で `linked_by` として表示する。auto（system 生成）は NULL。
既存行は NULL（過去の手動リンクは作成者不明＝表示なしにフォールバック）。

Revision ID: 0031_info_link_created_by
Revises: 0030_info_attachments
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0031_info_link_created_by"
down_revision = "0030_info_attachments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("info_links", sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_info_links_created_by", "info_links", "users", ["created_by_id"], ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_info_links_created_by", "info_links", type_="foreignkey")
    op.drop_column("info_links", "created_by_id")
