"""company: 旧 info_tokens を撤去（entity_tokens へ一本化・§5.36b・DFT N-TC-334）。

0044 で `info_tokens` を owner 非依存の `entity_tokens`（owner_type='info'）へ一般化し、その時点の
info_tokens を entity_tokens へコピー移送した。以後、ライブ書込（repo.replace_tokens）も読取
（word_cloud/類似度 all_info_tokens）も entity_tokens を使う。しかし **bootstrap の seed だけが旧
info_tokens に書き続けていた**ため、seed/デモ会社では entity_tokens に info 行が入らず
ワードクラウド/類似度が空になる不具合があった（seed は 0065 と同時に entity_tokens へ是正）。

本 migration は (1) 旧 info_tokens に取り残された行を entity_tokens へ backfill（冪等＝一意制約で重複スキップ）
してから、(2) 旧 info_tokens テーブルを drop する（dead legacy の根絶）。

Revision ID: 0065_drop_info_tokens
Revises: 0064_chat_messages_pm_json
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa


revision = "0065_drop_info_tokens"
down_revision = "0064_chat_messages_pm_json"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # (1) info_tokens の残存行を entity_tokens(owner_type='info') へ backfill（冪等）。
    #     既に 0044 で移送済みの行は uq_entity_tokens(owner_type,owner_id,token) で衝突→DO NOTHING。
    #     id は新規採番（0044 が info_tokens.id を再利用済みのため PK 衝突を避ける）。gen_random_uuid は PG13+ 内蔵。
    op.execute(
        """
        INSERT INTO entity_tokens (id, owner_type, owner_id, token, weight, count)
        SELECT gen_random_uuid(), 'info', info_item_id, token, weight, count
        FROM info_tokens
        ON CONFLICT (owner_type, owner_id, token) DO NOTHING
        """
    )
    # (2) 旧テーブルを撤去。
    op.drop_table("info_tokens")


def downgrade() -> None:
    # 旧 info_tokens を再作成し、entity_tokens(owner_type='info') から書き戻す（best-effort）。
    op.create_table(
        "info_tokens",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("info_item_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("info_items.id"), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("weight", sa.Numeric(6, 4), nullable=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("info_item_id", "token", name="uq_info_tokens"),
    )
    op.execute(
        """
        INSERT INTO info_tokens (id, info_item_id, token, weight, count)
        SELECT gen_random_uuid(), owner_id, token, weight, count
        FROM entity_tokens WHERE owner_type = 'info'
        ON CONFLICT (info_item_id, token) DO NOTHING
        """
    )
