"""company: 会社別の生成トークン上限（company_ai_model_settings.max_output_tokens・FR-45 S.5）。

無料ティアは出力を抑制、有料は緩める等の会社別ポリシー（NULL=無制限）。生成時に当該モデルの
会社設定を解決して gateway の max_tokens に反映する（暴走抑止＋課金ティア）。

Revision ID: 0049_ai_model_max_tokens
Revises: 0048_ai_jobs
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0049_ai_model_max_tokens"
down_revision = "0048_ai_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("company_ai_model_settings", sa.Column("max_output_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("company_ai_model_settings", "max_output_tokens")
