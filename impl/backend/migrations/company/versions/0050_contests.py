"""company: アイデアコンテスト段の新規テーブル群＋quests.origin_idea_id（FR-46/47・データモデル §5.60-5.64）。

純新規テーブルのみ（既存 ideas/votes/evaluations/chat/activities は無改修＝クエストを器に再利用）。
user_capabilities は②会社レベル能力の単一レジストリ（info_curators 統合は別ステップ・ここでは新規作成のみ）。

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内。）

Revision ID: 0050_contests
Revises: 0049_ai_model_max_tokens
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0050_contests"
down_revision = "0049_ai_model_max_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- contests（会期・テーマ・賞／backing quest と 1:1・§5.60） ---
    op.create_table(
        "contests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False, unique=True),
        sa.Column("mode", sa.Text(), nullable=False, server_default="bounded"),      # bounded | rolling
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),      # draft|open|judging|closed|archived
        sa.Column("theme", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_archive_days", sa.Integer(), nullable=True),
        sa.Column("prize_config", JSONB(), nullable=True),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_contests_status", "contests", ["status"])

    # --- contest_participants（Tier1：コンテスト参加＝閲覧＋投稿＋投票・§5.61） ---
    op.create_table(
        "contest_participants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("contest_id", UUID(as_uuid=True), sa.ForeignKey("contests.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="requested"),  # requested|approved|rejected|left
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("contest_id", "user_id", name="uq_contest_participant"),
    )

    # --- idea_participants（Tier2：個別アイデア参加＝チャット・§5.62） ---
    op.create_table(
        "idea_participants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="requested"),  # requested|approved|rejected|left
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),  # ＝アイデア投稿者
        sa.UniqueConstraint("idea_id", "user_id", name="uq_idea_participant"),
    )

    # --- user_capabilities（②会社レベル能力の単一レジストリ・§5.63） ---
    op.create_table(
        "user_capabilities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("capability", sa.Text(), nullable=False),  # info_curator|quest_create|contest_create|contest_evaluator
        sa.Column("granted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    # 有効な付与は能力ごと1行（info_curators の UNIQUE(user_id) WHERE revoked_at IS NULL を一般化）
    op.create_index("uq_user_capability_active", "user_capabilities", ["user_id", "capability"],
                    unique=True, postgresql_where=sa.text("revoked_at IS NULL"))

    # --- contest_idea_flags（殿堂入り/お蔵入り＝ideas 無改修の外付け・§5.64） ---
    op.create_table(
        "contest_idea_flags",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("contest_id", UUID(as_uuid=True), sa.ForeignKey("contests.id"), nullable=False),
        sa.Column("flag", sa.Text(), nullable=False),  # shelved | hall_of_fame
        sa.Column("granted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("granted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("idea_id", "flag", name="uq_contest_idea_flag"),
    )

    # --- quests.origin_idea_id（アイデア→クエスト昇格の由来参照・決定H・§5.6） ---
    op.add_column("quests", sa.Column("origin_idea_id", UUID(as_uuid=True),
                                      sa.ForeignKey("ideas.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("quests", "origin_idea_id")
    op.drop_table("contest_idea_flags")
    op.drop_index("uq_user_capability_active", table_name="user_capabilities")
    op.drop_table("user_capabilities")
    op.drop_table("idea_participants")
    op.drop_table("contest_participants")
    op.drop_index("ix_contests_status", table_name="contests")
    op.drop_table("contests")
