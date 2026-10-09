"""company: 情報の動的タブ info_tabs ＋ info_items.tab_id / auto_link_enabled（D4・§5.37c）。

会社が束ねる情報の器（1情報=1タブ）。「すべて」＝system・予約・特殊（既定所属＝default 箱／表示は全件）。
既存 info_items は「すべて」へ割当（backfill）。auto_link_enabled は情報別の自動類似リンク ON/OFF（既定 true）。

Revision ID: 0066_info_tabs
Revises: 0065_drop_info_tokens
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0066_info_tabs"
down_revision = "0065_drop_info_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # (1) info_tabs テーブル。
    op.create_table(
        "info_tabs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="user"),         # system/user/connector
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),      # active/archived
        sa.Column("icon_image_path", sa.Text(), nullable=True),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("connector_ref", sa.Text(), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_info_tabs_status_sort", "info_tabs", ["status", "sort_order"])
    # active 名は会社内一意（部分 UNIQUE）。
    op.create_index("uq_info_tabs_active_name", "info_tabs", ["name"], unique=True,
                    postgresql_where=sa.text("status = 'active'"))

    # (2) 「すべて」（system・予約・特殊）を seed（会社ごと 1 行・sort_order=0）。
    op.execute(
        "INSERT INTO info_tabs (id, name, kind, sort_order, status) "
        "VALUES (gen_random_uuid(), 'すべて', 'system', 0, 'active')"
    )

    # (3) info_items へ列追加（tab_id は一旦 nullable→backfill→NOT NULL）。
    op.add_column("info_items", sa.Column("tab_id", UUID(as_uuid=True), nullable=True))
    op.add_column("info_items", sa.Column(
        "auto_link_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    # 既存情報は「すべて」へ割当。
    op.execute("UPDATE info_items SET tab_id = (SELECT id FROM info_tabs WHERE kind='system' LIMIT 1)")
    op.alter_column("info_items", "tab_id", nullable=False)
    op.create_foreign_key("fk_info_items_tab", "info_items", "info_tabs", ["tab_id"], ["id"])
    op.create_index("ix_info_items_tab", "info_items", ["tab_id", "status", "created_at"])

    # (4) tab_id 未指定の INSERT は「すべて」(system) を補完する BEFORE INSERT トリガ。
    #     タブ非関与の直登録（他ドメインのテスト／incidental な info_items 作成）でも NOT NULL を満たすための安全網。
    #     アプリの登録経路は明示解決して渡す（トリガは保険）。
    op.execute(
        """
        CREATE OR REPLACE FUNCTION info_items_default_tab() RETURNS trigger AS $$
        BEGIN
          IF NEW.tab_id IS NULL THEN
            NEW.tab_id := (SELECT id FROM info_tabs WHERE kind='system' LIMIT 1);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER trg_info_items_default_tab BEFORE INSERT ON info_items "
        "FOR EACH ROW EXECUTE FUNCTION info_items_default_tab()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_info_items_default_tab ON info_items")
    op.execute("DROP FUNCTION IF EXISTS info_items_default_tab()")
    op.drop_index("ix_info_items_tab", table_name="info_items")
    op.drop_constraint("fk_info_items_tab", "info_items", type_="foreignkey")
    op.drop_column("info_items", "auto_link_enabled")
    op.drop_column("info_items", "tab_id")
    op.drop_index("uq_info_tabs_active_name", table_name="info_tabs")
    op.drop_index("ix_info_tabs_status_sort", table_name="info_tabs")
    op.drop_table("info_tabs")
