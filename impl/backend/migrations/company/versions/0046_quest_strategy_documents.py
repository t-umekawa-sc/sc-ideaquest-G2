"""company: クエスト↔適用経営資料（quest_strategy_documents・§5.56・FR-44）。

クエスト作成者が「適用する経営資料」を0..N手動選択する中間表（quest_group_links と同型）。
整合率の母集合＝クエストが選んだ資料（1アイデア N資料）。選択変更は quest_revisions のスナップショットに含める。

Revision ID: 0046_quest_strategy_docs
Revises: 0045_strategy_documents
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0046_quest_strategy_docs"
down_revision = "0045_strategy_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quest_strategy_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("strategy_document_id", UUID(as_uuid=True), sa.ForeignKey("strategy_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("quest_id", "strategy_document_id", name="uq_quest_strategy_documents"),
    )
    op.create_index("ix_quest_strategy_documents_quest", "quest_strategy_documents", ["quest_id"])
    op.create_index("ix_quest_strategy_documents_doc", "quest_strategy_documents", ["strategy_document_id"])


def downgrade() -> None:
    op.drop_index("ix_quest_strategy_documents_doc", table_name="quest_strategy_documents")
    op.drop_index("ix_quest_strategy_documents_quest", table_name="quest_strategy_documents")
    op.drop_table("quest_strategy_documents")
