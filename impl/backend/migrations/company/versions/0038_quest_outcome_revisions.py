"""company: 振り返り（quest_outcomes）の変更履歴＝内容の版（quest_outcome_revisions）

変更履歴の標準装備 Phase 2（FR-39・設計ドラフト doc/設計ドラフト/変更履歴標準.md §3.1）。
総括（summary/learnings/next_actions/metrics）の版スナップショット。ISO 56001 §10 改善の記録＝
「その時何を学び、次に何をしようとしたか」を追える。UI は折り畳み（概要パネル無し・SC-12 結果タブ）。

Revision ID: 0038_quest_outcome_revisions
Revises: 0037_concept_revisions
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0038_quest_outcome_revisions"
down_revision = "0037_concept_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quest_outcome_revisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("editor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changes", JSONB(), nullable=False),  # summary/learnings/next_actions/metrics のスナップショット
        sa.Column("memo", sa.Text(), nullable=True),  # 変更理由
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_quest_outcome_revisions_quest_rev", "quest_outcome_revisions", ["quest_id", "revision"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_quest_outcome_revisions_quest_rev", table_name="quest_outcome_revisions")
    op.drop_table("quest_outcome_revisions")
