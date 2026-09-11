"""company: quest_group_links テーブルを追加（クエスト複数部署横断・データモデル §5.6b・FR-38）

1クエスト＝主グループ（is_primary=true・quests.quest_group_id と一致）＋任意の追加グループ。門番（一覧可視性）と
パーティー候補は本テーブルの全グループを対象にする。**既存クエストは主グループのリンク行を backfill** する。

Revision ID: 0023_quest_group_links
Revises: 0022_company_idea_icon
Create Date: 2026-09-11

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0023_quest_group_links"
down_revision = "0022_company_idea_icon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quest_group_links",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("quest_group_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("quest_groups.id"), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("quest_id", "quest_group_id", name="uq_quest_group_links"),
    )
    op.create_index("ix_quest_group_links_group", "quest_group_links", ["quest_group_id"])
    # 主グループは1クエストにつき高々1（部分 UNIQUE）。
    op.create_index("uq_quest_group_links_primary", "quest_group_links", ["quest_id"],
                    unique=True, postgresql_where=sa.text("is_primary"))
    # 既存クエストの主グループ（quests.quest_group_id）をリンク行として backfill（is_primary=true）。
    op.execute(sa.text(
        "INSERT INTO quest_group_links (id, quest_id, quest_group_id, is_primary, created_at) "
        "SELECT gen_random_uuid(), q.id, q.quest_group_id, true, now() FROM quests q"
    ))


def downgrade() -> None:
    op.drop_index("uq_quest_group_links_primary", table_name="quest_group_links")
    op.drop_index("ix_quest_group_links_group", table_name="quest_group_links")
    op.drop_table("quest_group_links")
