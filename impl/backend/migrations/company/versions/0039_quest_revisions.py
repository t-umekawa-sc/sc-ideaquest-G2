"""company: クエスト定義の変更履歴＝内容の版（quest_revisions）＋ステータス意思決定ログ（quest_decision_log）

変更履歴の標準装備 Phase 3（設計ドラフト doc/設計ドラフト/変更履歴標準.md §3.1/§3.2）。
- quest_revisions＝定義項目（title/purpose/color/deadline/categories）のスナップ版（参加部署/権限は別意味＝含めない）。
- quest_decision_log＝ステータス遷移（draft/recruiting/in_progress/evaluating/completed）の追記型ログ。

Revision ID: 0039_quest_revisions
Revises: 0038_quest_outcome_revisions
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0039_quest_revisions"
down_revision = "0038_quest_outcome_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # quest_id は ON DELETE CASCADE（履歴はクエストの従属＝クエスト物理削除で一緒に消える。
    # 本番はクエストを soft delete〔deleted_at〕するため実発火しない＝監査保持と両立）。
    op.create_table(
        "quest_revisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("editor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changes", JSONB(), nullable=False),  # title/purpose/color/deadline/categories
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("uq_quest_revisions_quest_rev", "quest_revisions", ["quest_id", "revision"], unique=True)

    op.create_table(
        "quest_decision_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),  # status
        sa.Column("from_value", sa.Text(), nullable=True),
        sa.Column("to_value", sa.Text(), nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_quest_decision_log_quest_created", "quest_decision_log", ["quest_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_quest_decision_log_quest_created", table_name="quest_decision_log")
    op.drop_table("quest_decision_log")
    op.drop_index("uq_quest_revisions_quest_rev", table_name="quest_revisions")
    op.drop_table("quest_revisions")
