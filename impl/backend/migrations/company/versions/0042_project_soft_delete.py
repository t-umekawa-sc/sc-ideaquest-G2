"""company: projects にソフト削除列 deleted_at を追加（FR-43・Q.1）。

コンセプト1:1の部分ユニーク（uq_projects_concept）を「未削除のみ」に絞り、
ソフト削除後は同じコンセプトから再度プロジェクトを起票できるようにする。

Revision ID: 0042_project_soft_delete
Revises: 0041_solutions
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0042_project_soft_delete"
down_revision = "0041_solutions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    # 1コンセプト1プロジェクト＝部分ユニークを「未削除のみ」に絞る（削除後は再起票可）。
    op.drop_index("uq_projects_concept", table_name="projects")
    op.create_index(
        "uq_projects_concept", "projects", ["concept_id"], unique=True,
        postgresql_where=sa.text("concept_id IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_projects_concept", table_name="projects")
    op.create_index(
        "uq_projects_concept", "projects", ["concept_id"], unique=True,
        postgresql_where=sa.text("concept_id IS NOT NULL"),
    )
    op.drop_column("projects", "deleted_at")
