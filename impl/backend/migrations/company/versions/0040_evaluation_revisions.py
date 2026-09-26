"""company: 評価の変更履歴＝確定（submit）ごとの版（evaluation_revisions / concept_evaluation_revisions）

変更履歴の標準装備 Phase 4（設計ドラフト doc/設計ドラフト/変更履歴標準.md §3.6）。
アイデア評価（evaluations）・コンセプト評価（concept_evaluations）の**確定時**の内容スナップ版。
- 版は「評価を確定（submit）」で作成＝初回確定=初版・以降は確定ごと・下書き/無変更は版なし。
- FK は ON DELETE CASCADE（履歴は評価の従属＝評価削除に追随・本番は評価を消さない運用）。

Revision ID: 0040_evaluation_revisions
Revises: 0039_quest_revisions
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0040_evaluation_revisions"
down_revision = "0039_quest_revisions"
branch_labels = None
depends_on = None


def _revtable(name: str, parent: str) -> None:
    op.create_table(
        name,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("evaluation_id", UUID(as_uuid=True), sa.ForeignKey(f"{parent}.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("editor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changes", JSONB(), nullable=False),  # scores/comments/overall_comment/(recommendation)/visibility
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(f"uq_{name}_eval_rev", name, ["evaluation_id", "revision"], unique=True)


def upgrade() -> None:
    _revtable("evaluation_revisions", "evaluations")
    _revtable("concept_evaluation_revisions", "concept_evaluations")


def downgrade() -> None:
    op.drop_index("uq_concept_evaluation_revisions_eval_rev", table_name="concept_evaluation_revisions")
    op.drop_table("concept_evaluation_revisions")
    op.drop_index("uq_evaluation_revisions_eval_rev", table_name="evaluation_revisions")
    op.drop_table("evaluation_revisions")
