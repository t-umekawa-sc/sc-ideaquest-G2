"""company: quests / quest_categories / quest_members / quest_member_permissions を作成（データモデル §5.6〜§5.9）

ドメイン C（クエスト・パーティー・権限）のテナントテーブル群。論理削除（トゥームストーン）方針:
quests は `deleted_at`＋`deleted_by_id`、quest_members は `removed_at`。有効行の一意は部分ユニークで担保
（quest_members は `UNIQUE(quest_id, user_id) WHERE removed_at IS NULL`＝除外後の再追加を許容）。
enum（quest_status/permission_type）は §5.3 と同方針で String 列で持つ（DB enum 型は使わない）。

Revision ID: 0009_company_quests
Revises: 0008_company_users_bg_image
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0009_company_quests"
down_revision = "0008_company_users_bg_image"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_group_id", UUID(as_uuid=True), sa.ForeignKey("quest_groups.id"), nullable=False),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("color", sa.String(32), nullable=False),
        sa.Column("purpose", sa.String(), nullable=True),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("icon_image_path", sa.String(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # 有効クエストのグループ×状態引き（一覧の参照範囲＋status 絞り・§5.6）。
    op.create_index(
        "ix_quests_group_status_active",
        "quests",
        ["quest_group_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("ix_quests_owner", "quests", ["owner_id"])

    op.create_table(
        "quest_categories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("is_custom", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_quest_categories_quest", "quest_categories", ["quest_id"])
    # 同一クエスト内のカテゴリ重複防止（§5.7）。
    op.create_index(
        "uq_quest_categories_quest_label", "quest_categories", ["quest_id", "label"], unique=True
    )

    op.create_table(
        "quest_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # 有効な参加（removed_at IS NULL）は (quest, user) で一意＝重複参加禁止・除外後の再追加は許容（§5.8）。
    op.create_index(
        "uq_quest_members_active",
        "quest_members",
        ["quest_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("removed_at IS NULL"),
    )

    op.create_table(
        "quest_member_permissions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_member_id", UUID(as_uuid=True), sa.ForeignKey("quest_members.id"), nullable=False),
        sa.Column("permission", sa.String(32), nullable=False),
        sa.Column("granted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # 同一参加者の同一権限は1行（§5.9）。
    op.create_index(
        "uq_quest_member_permissions", "quest_member_permissions", ["quest_member_id", "permission"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_quest_member_permissions", table_name="quest_member_permissions")
    op.drop_table("quest_member_permissions")
    op.drop_index("uq_quest_members_active", table_name="quest_members")
    op.drop_table("quest_members")
    op.drop_index("uq_quest_categories_quest_label", table_name="quest_categories")
    op.drop_index("ix_quest_categories_quest", table_name="quest_categories")
    op.drop_table("quest_categories")
    op.drop_index("ix_quests_owner", table_name="quests")
    op.drop_index("ix_quests_group_status_active", table_name="quests")
    op.drop_table("quests")
