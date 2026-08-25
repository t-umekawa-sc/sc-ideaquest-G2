"""company: evaluations / evaluation_scores を作成（§5.21/§5.22・ドメイン F 評価）

評価（1アイデア×評価者1人1評価・draft/submitted）と観点スコア（5観点・1..5）。enum（evaluation_status/
evaluation_visibility/evaluation_aspect）は §5.3 と同方針で String 列＋CHECK。XP/コイン記帳は activities（G）。

Revision ID: 0012_company_evaluations
Revises: 0011_company_idearev_created
Create Date: 2026-08-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0012_company_evaluations"
down_revision = "0011_company_idearev_created"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evaluations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("evaluator_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("overall_comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("visibility", sa.String(16), nullable=False, server_default="party"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("uq_evaluations_idea_evaluator", "evaluations", ["idea_id", "evaluator_id"], unique=True)
    op.create_index("ix_evaluations_idea_status", "evaluations", ["idea_id", "status"])

    op.create_table(
        "evaluation_scores",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("evaluation_id", UUID(as_uuid=True), sa.ForeignKey("evaluations.id"), nullable=False),
        sa.Column("aspect", sa.String(16), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.CheckConstraint("score >= 1 AND score <= 5", name="ck_evaluation_scores_range"),
    )
    op.create_index("uq_evaluation_scores_eval_aspect", "evaluation_scores", ["evaluation_id", "aspect"], unique=True)


def downgrade() -> None:
    op.drop_table("evaluation_scores")
    op.drop_table("evaluations")
