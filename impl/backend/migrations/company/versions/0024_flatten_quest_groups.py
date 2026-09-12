"""company: 参加部署をフラット化＝主グループ（is_primary）と quests.quest_group_id を撤去

FR-38 再設計（2026-09-11・データモデル §5.6/§5.6b）＝参加部署（quest_group_links）はフラットな 0..N・
すべて同格（アクセス条件）。主グループ（primary）概念を廃止し、quests から単一グループ FK 列を撤去する。
既存クエストの旧主グループは 0023 の backfill で quest_group_links の行として保全済み＝列削除でデータは失わない。

Revision ID: 0024_flatten_quest_groups
Revises: 0023_quest_group_links
Create Date: 2026-09-12

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0024_flatten_quest_groups"
down_revision = "0023_quest_group_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) 主グループ（primary）概念を撤去＝部分 UNIQUE と is_primary 列を削除（フラット 0..N・すべて同格）。
    op.drop_index("uq_quest_group_links_primary", table_name="quest_group_links")
    op.drop_column("quest_group_links", "is_primary")

    # 2) quests から単一グループ FK 列を撤去（参加部署は quest_group_links に多対多で保持・§5.6b）。
    #    旧列に依存する索引を先に落とす（列削除で FK 制約は自動的に落ちる）。
    op.drop_index("ix_quests_group_status_active", table_name="quests")
    op.drop_column("quests", "quest_group_id")
    # 新モデルの一覧絞り＝status（可視性はパーティー×参加部署 links で強制・§5.6）。
    op.create_index(
        "ix_quests_status_active", "quests", ["status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    # best-effort な巻き戻し。新モデルでは参加部署 0 件のクエストが存在しうるため、
    # quest_group_id は NULL 可のまま復元する（旧 NOT NULL は厳密には再現しない）。
    op.drop_index("ix_quests_status_active", table_name="quests")

    # quests.quest_group_id を復活（links の最古1件を旧主グループとみなして backfill）。
    op.add_column(
        "quests",
        sa.Column("quest_group_id", UUID(as_uuid=True), sa.ForeignKey("quest_groups.id"), nullable=True),
    )
    op.execute(sa.text(
        "UPDATE quests q SET quest_group_id = ("
        "  SELECT l.quest_group_id FROM quest_group_links l"
        "  WHERE l.quest_id = q.id ORDER BY l.created_at ASC, l.id ASC LIMIT 1)"
    ))
    op.create_index(
        "ix_quests_group_status_active", "quests", ["quest_group_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # quest_group_links.is_primary を復活（各クエストの最古リンクを primary に）。
    op.add_column(
        "quest_group_links",
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(sa.text(
        "UPDATE quest_group_links l SET is_primary = true WHERE l.id = ("
        "  SELECT l2.id FROM quest_group_links l2"
        "  WHERE l2.quest_id = l.quest_id ORDER BY l2.created_at ASC, l2.id ASC LIMIT 1)"
    ))
    op.create_index(
        "uq_quest_group_links_primary", "quest_group_links", ["quest_id"],
        unique=True, postgresql_where=sa.text("is_primary"),
    )
