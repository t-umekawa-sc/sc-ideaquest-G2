"""company: 情報インプットの参考資料（info_attachments・N.2/§5.33 追補）

参考資料＝内容群の一部（作成者が編集・§5.33）。本文とは別に PDF/画像/資料ファイルを添付し出典の裏付け/
引用元を保全する。物理は MinIO（object_key＝ハッシュ名・元名は別列）＝アイデア添付（attachments）と同型。

Revision ID: 0030_info_attachments
Revises: 0029_info_revisions
Create Date: 2026-09-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0030_info_attachments"
down_revision = "0029_info_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "info_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("info_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),        # MinIO 物理名（ハッシュ・元名非露出）
        sa.Column("original_name", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("idx_info_attachments_item", "info_attachments", ["info_item_id"])


def downgrade() -> None:
    op.drop_index("idx_info_attachments_item", table_name="info_attachments")
    op.drop_table("info_attachments")
