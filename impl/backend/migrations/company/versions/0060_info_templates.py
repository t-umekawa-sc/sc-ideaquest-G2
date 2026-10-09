"""company: 内部情報テンプレート `info_templates`＋`info_items.source_template_id`（データモデル §5.37b・FR-41 ⑩）。

情報登録モーダル（SC-51）で選ぶと本文ひな形（見出し＋記入欄プレースホルダ）＋属性既定値がフォームへ入る
会社共通マスタ。管理＝会社管理者・閲覧/適用＝会社内 active 全員。テンプレートと情報は疎結合＝登録後の
`info_items` はテンプレを参照せず不変（由来のみ `source_template_id` に記録）。本文ひな形は保存時 nh3
サニタイズ（API N.5b・多層防御）。

- `info_templates`＝name（有効内一意）/description/title_template/body_html/defaults(jsonb)/sort_order/
  is_active/論理削除（deleted_at/deleted_by_id）＋共通監査（created_by_id/created_at/updated_at）。
- 部分一意索引 `UNIQUE(name) WHERE deleted_at IS NULL`（有効内の名前一意・無効も一意対象／削除済みは再利用可）。
- `(is_active, sort_order) WHERE deleted_at IS NULL`（ピッカー/有効一覧）。
- `info_items.source_template_id uuid NULL FK→info_templates`（由来記録・分析用・論理削除後も ID 保持）。

Revision ID: 0060_info_templates
Revises: 0059_quests_recommended
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "0060_info_templates"
down_revision = "0059_quests_recommended"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "info_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("title_template", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=False),
        sa.Column("defaults", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 有効（deleted_at IS NULL）内で名称一意（無効も一意対象・削除済みの名前は再利用可・§9-2）。
    op.create_index(
        "uq_info_templates_name_active",
        "info_templates",
        ["name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    # ピッカー/有効一覧（sort_order 順）の絞り込み索引。
    op.create_index(
        "ix_info_templates_active_sort",
        "info_templates",
        ["is_active", "sort_order"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    # 情報の由来テンプレート（分析用・疎結合＝論理削除後も ID を履歴として保持）。
    op.add_column(
        "info_items",
        sa.Column("source_template_id", UUID(as_uuid=True), sa.ForeignKey("info_templates.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("info_items", "source_template_id")
    op.drop_index("ix_info_templates_active_sort", table_name="info_templates")
    op.drop_index("uq_info_templates_name_active", table_name="info_templates")
    op.drop_table("info_templates")
