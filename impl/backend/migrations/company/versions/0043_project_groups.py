"""company: projects の参加グループ（アクセス条件）＝project_group_links（FR-43・Q.1）。

クエストの quest_group_links と同型＝プロジェクトに 0..N の会社グループ（quest_groups）を紐づけ、
アクセス条件（owner/project_member/quest_party に加え、参加グループの現所属者も参照可）とする。

Revision ID: 0043_project_groups
Revises: 0042_project_soft_delete
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0043_project_groups"
down_revision = "0042_project_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_group_links",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quest_group_id", UUID(as_uuid=True), sa.ForeignKey("quest_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "quest_group_id", name="uq_project_group_links"),
    )
    op.create_index("ix_project_group_links_project", "project_group_links", ["project_id"])
    op.create_index("ix_project_group_links_group", "project_group_links", ["quest_group_id"])


def downgrade() -> None:
    op.drop_index("ix_project_group_links_group", table_name="project_group_links")
    op.drop_index("ix_project_group_links_project", table_name="project_group_links")
    op.drop_table("project_group_links")
