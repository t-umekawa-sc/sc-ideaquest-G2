"""company: quest_groups / quest_group_members を作成（データモデル §5.4/§5.5）

クエストグループ本体と、ユーザー×グループ所属（唯一の正・§8-①）。所属は物理削除せず
`removed_at` トゥームストーンで解除する。有効な所属の重複は部分ユニークで禁止し、
解除後（`removed_at` 値あり）の再所属は許容する（§5.5）。B と C の境界＝所属は会社DBに置く。

Revision ID: 0005_company_quest_groups
Revises: 0004_company_users_identity
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0005_company_quest_groups"
down_revision = "0004_company_users_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quest_groups",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_group_code", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "quest_group_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_group_id", UUID(as_uuid=True), sa.ForeignKey("quest_groups.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False, server_default="member"),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # 有効な所属（removed_at IS NULL）は (group, user) で一意＝重複所属禁止・解除後の再所属は許容（§5.5）
    op.create_index(
        "uq_quest_group_members_active",
        "quest_group_members",
        ["quest_group_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("removed_at IS NULL"),
    )
    # ユーザの有効な所属グループ引き（ログイン後の参照範囲判定・§5.5）
    op.create_index(
        "ix_quest_group_members_user_active",
        "quest_group_members",
        ["user_id"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_quest_group_members_user_active", table_name="quest_group_members")
    op.drop_index("uq_quest_group_members_active", table_name="quest_group_members")
    op.drop_table("quest_group_members")
    op.drop_table("quest_groups")
