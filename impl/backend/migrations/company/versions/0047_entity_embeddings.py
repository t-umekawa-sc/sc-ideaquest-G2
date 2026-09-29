"""company: 成果物本文の埋め込みベクトル entity_embeddings（意味的一致・A-2・FR-44）。

アイデア／経営資料の本文を LLM 基盤の OpenAI 互換 `/embeddings` でベクトル化して保持し、整合率の
「意味的一致（keyword/embedding/hybrid）」の入力にする。ベクトルは JSONB（float 配列）で cosine は
Python 計算（pgvector 非依存）。`model`/`dim` を保存しモデル差し替え時は不一致行を無効化＝再計算。

Revision ID: 0047_entity_embeddings
Revises: 0046_quest_strategy_docs
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0047_entity_embeddings"
down_revision = "0046_quest_strategy_docs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "entity_embeddings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_type", sa.Text(), nullable=False),  # idea/strategy_doc/…（論理enum）
        sa.Column("owner_id", UUID(as_uuid=True), nullable=False),  # ソフト参照（多態・物理FKなし）
        sa.Column("model", sa.Text(), nullable=False),  # 埋め込みモデル名（差し替え検出用）
        sa.Column("dim", sa.Integer(), nullable=False),  # ベクトル次元
        sa.Column("vector", JSONB(), nullable=False),  # float 配列（cosine は Python 計算）
        sa.UniqueConstraint("owner_type", "owner_id", name="uq_entity_embeddings"),
    )
    op.create_index("ix_entity_embeddings_owner", "entity_embeddings", ["owner_type", "owner_id"])


def downgrade() -> None:
    op.drop_index("ix_entity_embeddings_owner", table_name="entity_embeddings")
    op.drop_table("entity_embeddings")
