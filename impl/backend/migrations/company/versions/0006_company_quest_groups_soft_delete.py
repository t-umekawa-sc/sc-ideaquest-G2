"""company: quest_groups に deleted_at（トゥームストーン）＋コード一意を部分ユニーク化（データモデル §5.4）

グループ削除をトゥームストーン（物理削除しない）で行うため `deleted_at` を追加。コードの一意制約は
「有効（`deleted_at IS NULL`）なグループの中で一意」に変更＝削除後の同コード再作成を許容（API設計 B.3.1）。

Revision ID: 0006_company_qg_soft_delete
Revises: 0005_company_quest_groups
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_company_qg_soft_delete"
down_revision = "0005_company_quest_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("quest_groups", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    # 全体 UNIQUE（0005 の列定義 unique=True＝postgres 既定名）を落とし、有効行のみの部分ユニークへ
    op.drop_constraint("quest_groups_quest_group_code_key", "quest_groups", type_="unique")
    op.create_index(
        "uq_quest_groups_code_active",
        "quest_groups",
        ["quest_group_code"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_quest_groups_code_active", table_name="quest_groups")
    op.create_unique_constraint("quest_groups_quest_group_code_key", "quest_groups", ["quest_group_code"])
    op.drop_column("quest_groups", "deleted_at")
