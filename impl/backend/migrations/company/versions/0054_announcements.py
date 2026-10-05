"""company: お知らせ（announcements / announcement_reads・FR-49・データモデル §5.65/5.66）。

全社お知らせ（管理者投稿・全ユーザー閲覧）。本文リッチテキストは保存時サニタイズ済 body_html＋平文 body_text。
既読は announcement_reads（UNIQUE(announcement_id,user_id)・冪等）。通知連携なし。

Revision ID: 0054_announcements
Revises: 0053_contest_auto_approve
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0054_announcements"
down_revision = "0053_contest_auto_approve"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # 表示対象の絞り＋並び（published×掲載期間内・pinned→published_at 降順）を支える索引。
    op.create_index("ix_announcements_status_pub", "announcements", ["status", "published_at"])

    op.create_table(
        "announcement_reads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("announcement_id", UUID(as_uuid=True), sa.ForeignKey("announcements.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("announcement_id", "user_id", name="uq_announcement_reads"),
    )


def downgrade() -> None:
    op.drop_table("announcement_reads")
    op.drop_index("ix_announcements_status_pub", table_name="announcements")
    op.drop_table("announcements")
