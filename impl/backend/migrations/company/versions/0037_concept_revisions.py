"""company: コンセプトの変更履歴＝内容の版（concept_revisions）＋意思決定ログ（concept_decision_log）

変更履歴の標準装備 Phase 1（FR-42・設計ドラフト doc/設計ドラフト/変更履歴標準.md §3.1/§3.2）。
- concept_revisions＝内容スナップショット版（アイデア idea_revisions と同型・JSONB changes・UNIQUE(concept_id, revision)）。
  context_snapshot＝その版時点の判断材料の数値サマリ（投票/評価/前提の検証状況・§3.3）。
- concept_decision_log＝意思決定/ステータスの追記型タイムライン（decision: Go/Pivot/Kill・status: draft/active/archived）。

Revision ID: 0037_concept_revisions
Revises: 0036_concept_scope_kind_uq_fix
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0037_concept_revisions"
down_revision = "0036_concept_scope_kind_uq_fix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "concept_revisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("editor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changes", JSONB(), nullable=False),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("context_snapshot", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_concept_revisions_concept_rev", "concept_revisions", ["concept_id", "revision"], unique=True)

    op.create_table(
        "concept_decision_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),  # status / decision
        sa.Column("from_value", sa.Text(), nullable=True),
        sa.Column("to_value", sa.Text(), nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("context_snapshot", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_concept_decision_log_concept_created", "concept_decision_log", ["concept_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_concept_decision_log_concept_created", table_name="concept_decision_log")
    op.drop_table("concept_decision_log")
    op.drop_index("uq_concept_revisions_concept_rev", table_name="concept_revisions")
    op.drop_table("concept_revisions")
