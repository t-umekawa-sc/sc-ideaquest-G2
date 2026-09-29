"""company: 経営資料と整合スコア（strategy_documents / idea_alignment・§5.54-5.55・FR-44）。

経営の中長期計画/方針資料（管理者のみ・ISO56001 構造化項目）と、アイデア×経営資料の整合率（派生キャッシュ）。
トークンは entity_tokens（owner_type='strategy_doc'・0044）を再利用する。

Revision ID: 0045_strategy_documents
Revises: 0044_entity_tokens
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision = "0045_strategy_documents"
down_revision = "0044_entity_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "strategy_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("doc_kind", sa.Text(), nullable=False, server_default="other"),
        sa.Column("intent", sa.Text(), nullable=True),
        sa.Column("policy_commitment", sa.Text(), nullable=True),
        sa.Column("strategy", sa.Text(), nullable=True),
        sa.Column("focus_areas", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("objectives", sa.Text(), nullable=True),
        sa.Column("body_md", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("period_from", sa.Date(), nullable=True),
        sa.Column("period_to", sa.Date(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_strategy_documents_status", "strategy_documents", ["status"])
    op.create_index("ix_strategy_documents_kind", "strategy_documents", ["doc_kind"])

    op.create_table(
        "idea_alignment",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("strategy_document_id", UUID(as_uuid=True), sa.ForeignKey("strategy_documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("score", sa.Numeric(4, 3), nullable=False),
        sa.Column("method", sa.Text(), nullable=False, server_default="keyword"),
        sa.Column("matched_tokens", JSONB(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("idea_id", "strategy_document_id", name="uq_idea_alignment"),
    )
    op.create_index("ix_idea_alignment_idea", "idea_alignment", ["idea_id"])
    op.create_index("ix_idea_alignment_strategy", "idea_alignment", ["strategy_document_id"])


def downgrade() -> None:
    op.drop_index("ix_idea_alignment_strategy", table_name="idea_alignment")
    op.drop_index("ix_idea_alignment_idea", table_name="idea_alignment")
    op.drop_table("idea_alignment")
    op.drop_index("ix_strategy_documents_kind", table_name="strategy_documents")
    op.drop_index("ix_strategy_documents_status", table_name="strategy_documents")
    op.drop_table("strategy_documents")
