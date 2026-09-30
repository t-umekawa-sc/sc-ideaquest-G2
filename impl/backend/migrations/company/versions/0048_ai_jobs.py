"""company: AIジョブ基盤（ai_jobs / company_ai_model_settings / ai_usage_events・§5.57-5.59・FR-45）。

LLM を要する非同期処理の状態機械（テーブル自身がキュー）＋会社のモデル ON/OFF・予算＋利用量メータリング
（課金基礎＝追記専用・単価スナップショット）。ref_* は既存の会社DBテーブル（ideas/quests/
strategy_documents/info_items）を指す多態遷移先。

Revision ID: 0048_ai_jobs
Revises: 0047_entity_embeddings
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0048_ai_jobs"
down_revision = "0047_entity_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("task_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("execution", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("requested_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("input", JSONB(), nullable=False),
        sa.Column("result", JSONB(), nullable=True),
        sa.Column("error", JSONB(), nullable=True),
        sa.Column("requested_model", sa.Text(), nullable=True),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_micros", sa.BigInteger(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("progress", JSONB(), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ref_idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=True),
        sa.Column("ref_quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=True),
        sa.Column("ref_strategy_document_id", UUID(as_uuid=True), sa.ForeignKey("strategy_documents.id"), nullable=True),
        sa.Column("ref_info_item_id", UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_jobs_status_created", "ai_jobs", ["status", "created_at"])
    op.create_index("ix_ai_jobs_requester", "ai_jobs", ["requested_by_id", "created_at"])

    op.create_table(
        "company_ai_model_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("model_key", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("monthly_budget_micros", sa.BigInteger(), nullable=True),
        sa.Column("enabled_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("model_key", name="uq_company_ai_model_settings_key"),
    )

    op.create_table(
        "ai_usage_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("ai_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("period_ym", sa.Integer(), nullable=False),
        sa.Column("model_key", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("task_type", sa.Text(), nullable=False),
        sa.Column("requested_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("billing", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extra_units", JSONB(), nullable=True),
        sa.Column("rate_snapshot", JSONB(), nullable=False),
        sa.Column("cost_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_usage_events_period_model", "ai_usage_events", ["period_ym", "model_key"])
    op.create_index("ix_ai_usage_events_period", "ai_usage_events", ["period_ym"])
    op.create_index("ix_ai_usage_events_job", "ai_usage_events", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_events_job", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_period", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_period_model", table_name="ai_usage_events")
    op.drop_table("ai_usage_events")
    op.drop_table("company_ai_model_settings")
    op.drop_index("ix_ai_jobs_requester", table_name="ai_jobs")
    op.drop_index("ix_ai_jobs_status_created", table_name="ai_jobs")
    op.drop_table("ai_jobs")
