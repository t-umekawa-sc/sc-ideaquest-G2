"""company: ideas / idea_stakeholders / attachments / votes / idea_revisions / follows を作成（§5.10〜§5.14・§5.23）

ドメイン D（アイデア・添付・版・投票・フォロー）のテナントテーブル群。論理削除は ideas の
`deleted_at`＋`deleted_by_id`（トゥームストーン）。enum（idea_status/vote_type）は §5.3 と同方針で String 列。
attachments.chat_message_id は E（chat_messages）未作成のため現段階は FK なし（E migration で FK を張る）。
PGroonga 全文検索索引（attachments.original_name・§6）は J ドメインで追加（拡張未導入のため本 migration では張らない）。

Revision ID: 0010_company_ideas
Revises: 0009_company_quests
Create Date: 2026-08-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0010_company_ideas"
down_revision = "0009_company_quests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ideas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), nullable=False),
        sa.Column("author_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("time_limit", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("is_selected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("current_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # 有効アイデアのクエスト×状態引き（一覧＝クエスト内・status 絞り・§5.10）。
    op.create_index(
        "ix_ideas_quest_status_active", "ideas", ["quest_id", "status"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index("ix_ideas_author", "ideas", ["author_id"])

    op.create_table(
        "idea_stakeholders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("is_custom", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_idea_stakeholders_idea", "idea_stakeholders", ["idea_id"])
    op.create_index(
        "uq_idea_stakeholders_idea_label", "idea_stakeholders", ["idea_id", "label"], unique=True
    )

    op.create_table(
        "attachments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=True),
        # E（chat_messages）未作成＝FK なしの UUID 列。E migration で FK を張る。
        sa.Column("chat_message_id", UUID(as_uuid=True), nullable=True),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("original_name", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("uploaded_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # どちらか一方に紐づく／サイズ上限 20MB（§5.12/§8-⑦）。
        sa.CheckConstraint("idea_id IS NOT NULL OR chat_message_id IS NOT NULL", name="ck_attachments_target"),
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 20971520", name="ck_attachments_size"),
    )
    op.create_index("ix_attachments_idea", "attachments", ["idea_id"])
    op.create_index("ix_attachments_chat_message", "attachments", ["chat_message_id"])

    op.create_table(
        "votes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("voted_revision", sa.Integer(), nullable=False),
        sa.Column("voted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # 1人1票（賛成/反対の切替・取消は同一行の更新/削除・§5.13）。
    op.create_index("uq_votes_idea_user", "votes", ["idea_id", "user_id"], unique=True)

    op.create_table(
        "idea_revisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("editor_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changes", JSONB(), nullable=False),
        sa.Column("memo", sa.Text(), nullable=True),
    )
    op.create_index("uq_idea_revisions_idea_revision", "idea_revisions", ["idea_id", "revision"], unique=True)

    op.create_table(
        "follows",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("idea_id", UUID(as_uuid=True), sa.ForeignKey("ideas.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("uq_follows_user_idea", "follows", ["user_id", "idea_id"], unique=True)


def downgrade() -> None:
    op.drop_table("follows")
    op.drop_table("idea_revisions")
    op.drop_table("votes")
    op.drop_table("attachments")
    op.drop_table("idea_stakeholders")
    op.drop_table("ideas")
