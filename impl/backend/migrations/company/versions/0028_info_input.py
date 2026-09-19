"""company: 情報インプット（FR-41・info_items ほか）

外部WEB情報の会社横断の知識レイヤ（データモデル §5.33-5.37）。info_items（本体）＋info_item_categories
（#8 M:N）＋info_links（情報↔成果物の関連/裏付け/反証・多態）＋info_tokens（本文トークン派生＝ワード
クラウド/類似度）＋info_curators（情報判定権限・会社単位）。enum は §5.3 と同方針で String 列。
全文検索（FR-31）＝title/body_text を PGroonga 索引（HTML でなく平文を索引）。

Revision ID: 0028_info_input
Revises: 0027_quest_discovery
Create Date: 2026-09-19

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0028_info_input"
down_revision = "0027_quest_discovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 情報本体（§5.33）。低摩擦登録＝title/body/url は全ユーザー（status=raw）／curated 属性は info_curator。
    op.create_table(
        "info_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("parent_info_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("summary_generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="raw"),
        sa.Column("priority", sa.String(16), nullable=True),
        sa.Column("source", sa.String(24), nullable=True),
        sa.Column("classification", sa.String(24), nullable=True),
        sa.Column("scope", sa.String(16), nullable=True),
        sa.Column("target_business", sa.String(32), nullable=True),
        sa.Column("impact_level", sa.String(16), nullable=True),
        sa.Column("impact_class", sa.String(16), nullable=True),
        sa.Column("impact_timing", sa.String(16), nullable=True),
        sa.Column("triaged_on", sa.Date(), nullable=True),
        sa.Column("triage", sa.String(24), nullable=True),
        sa.Column("triage_reason", sa.Text(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        # 共通監査（§2.1）
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 一覧（アーカイブ除外の状態絞り）／機会・脅威の抽出／登録者／続報スレッド。
    op.create_index("ix_info_items_status_active", "info_items", ["status"], postgresql_where=sa.text("archived_at IS NULL"))
    op.create_index("ix_info_items_impact_curated", "info_items", ["impact_class"], postgresql_where=sa.text("status = 'curated'"))
    op.create_index("ix_info_items_created_by", "info_items", ["created_by_id"])
    op.create_index("ix_info_items_parent", "info_items", ["parent_info_id"], postgresql_where=sa.text("parent_info_id IS NOT NULL"))
    # 全文検索（FR-31・§6）＝title＋body_text（平文）を PGroonga 索引。
    op.execute("CREATE EXTENSION IF NOT EXISTS pgroonga")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_info_items_fts ON info_items "
        "USING pgroonga ((title || ' ' || coalesce(body_text, '')))"
    )

    # 情報カテゴリ（#8・複数可＝M:N・§5.34）
    op.create_table(
        "info_item_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("info_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.UniqueConstraint("info_item_id", "category", name="uq_info_item_categories"),
    )
    op.create_index("ix_info_item_categories_category", "info_item_categories", ["category"])

    # 情報↔成果物の動的リンク（関連/裏付け/反証・多態・§5.35）
    op.create_table(
        "info_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("info_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=False),
        sa.Column("target_type", sa.String(16), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),  # 多態参照＝物理 FK なし（§2.2 #4）
        sa.Column("kind", sa.String(16), nullable=False, server_default="related"),
        sa.Column("origin", sa.String(8), nullable=False),
        sa.Column("score", sa.Numeric(4, 3), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("info_item_id", "target_type", "target_id", name="uq_info_links"),
    )
    op.create_index("ix_info_links_target", "info_links", ["target_type", "target_id"], postgresql_where=sa.text("rejected_at IS NULL"))
    op.create_index("ix_info_links_info_item", "info_links", ["info_item_id"])
    op.create_index("ix_info_links_refuting", "info_links", ["kind"], postgresql_where=sa.text("kind = 'refuting'"))

    # 本文トークン（派生＝ワードクラウド/類似度・§5.36）
    op.create_table(
        "info_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("info_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("info_items.id"), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("weight", sa.Numeric(6, 4), nullable=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("info_item_id", "token", name="uq_info_tokens"),
    )
    op.create_index("ix_info_tokens_token", "info_tokens", ["token"])

    # 情報判定権限（会社/テナント単位・§5.37）
    op.create_table(
        "info_curators",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("granted_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_info_curators_active", "info_curators", ["user_id"], unique=True, postgresql_where=sa.text("revoked_at IS NULL"))
    op.create_index("ix_info_curators_user", "info_curators", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_info_curators_user", table_name="info_curators")
    op.drop_index("ix_info_curators_active", table_name="info_curators")
    op.drop_table("info_curators")
    op.drop_index("ix_info_tokens_token", table_name="info_tokens")
    op.drop_table("info_tokens")
    op.drop_index("ix_info_links_refuting", table_name="info_links")
    op.drop_index("ix_info_links_info_item", table_name="info_links")
    op.drop_index("ix_info_links_target", table_name="info_links")
    op.drop_table("info_links")
    op.drop_index("ix_info_item_categories_category", table_name="info_item_categories")
    op.drop_table("info_item_categories")
    op.execute("DROP INDEX IF EXISTS idx_info_items_fts")
    op.drop_index("ix_info_items_parent", table_name="info_items")
    op.drop_index("ix_info_items_created_by", table_name="info_items")
    op.drop_index("ix_info_items_impact_curated", table_name="info_items")
    op.drop_index("ix_info_items_status_active", table_name="info_items")
    op.drop_table("info_items")
