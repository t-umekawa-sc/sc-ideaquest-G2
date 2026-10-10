"""company: 会社の AI 動作ポリシー company_ai_settings（§5.67・公開時自動評価の会社別 ON/OFF）。

会社横断（モデル非依存）のシングルトン。初版は auto_evaluate_on_publish のみ（NULL=env 既定継承）。
会社ごと 1 行を seed＝GET /admin/ai-policy は常に値を返せる。per-model の company_ai_model_settings
（§5.58）とは粒度が違う（あちらは論理キー別の ON/OFF・予算・生成上限）。

Revision ID: 0067_company_ai_settings
Revises: 0066_info_tabs
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0067_company_ai_settings"
down_revision = "0066_info_tabs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_ai_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        # NULL=デプロイ既定（env llm_auto_evaluate_on_publish）を継承／true/false=会社の明示上書き。
        sa.Column("auto_evaluate_on_publish", sa.Boolean(), nullable=True),
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    # シングルトン 1 行を seed（auto_evaluate_on_publish=NULL＝env 既定継承）。
    op.execute(
        "INSERT INTO company_ai_settings (id, auto_evaluate_on_publish) "
        "VALUES (gen_random_uuid(), NULL)"
    )


def downgrade() -> None:
    op.drop_table("company_ai_settings")
