"""company: 成果物横断トークン entity_tokens（info_tokens の owner 非依存一般化・§5.36b・N.6 土台）。

info_tokens（§5.36）を owner_type/owner_id 方式へ一般化し、情報／アイデア／コンセプト／クエスト／前提／経営資料の
本文トークンを同一表で保持する（自動関連付けの双方向を都度再抽出なしで行う土台）。既存 info_tokens は
`owner_type='info'` としてコピー移送し、**info_tokens テーブルは当面残置**（§5.36・非破壊移行）。

Revision ID: 0044_entity_tokens
Revises: 0043_project_groups
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0044_entity_tokens"
down_revision = "0043_project_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "entity_tokens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_type", sa.Text(), nullable=False),  # info/idea/concept/quest/assumption/strategy_doc（論理enum）
        sa.Column("owner_id", UUID(as_uuid=True), nullable=False),  # ソフト参照（多態・物理FKなし）
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("weight", sa.Numeric(6, 4), nullable=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("owner_type", "owner_id", "token", name="uq_entity_tokens"),
    )
    op.create_index("ix_entity_tokens_owner", "entity_tokens", ["owner_type", "owner_id"])
    op.create_index("ix_entity_tokens_token", "entity_tokens", ["token"])

    # 既存 info_tokens を owner_type='info' としてコピー移送（id は再利用＝冪等・重複時は何もしない）。
    op.execute(
        """
        INSERT INTO entity_tokens (id, owner_type, owner_id, token, weight, count)
        SELECT id, 'info', info_item_id, token, weight, count FROM info_tokens
        ON CONFLICT (owner_type, owner_id, token) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index("ix_entity_tokens_token", table_name="entity_tokens")
    op.drop_index("ix_entity_tokens_owner", table_name="entity_tokens")
    op.drop_table("entity_tokens")
