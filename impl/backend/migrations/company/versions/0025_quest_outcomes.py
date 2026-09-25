"""company: クエスト最終結果（検証済みコンセプト票）の総括を保持する quest_outcomes

FR-39（ISO 56001 準拠・クエスト完了時の成果クローズ）。①検証済みコンセプト/②検証サマリ/③意思決定は
既存集計（選定/評価/投票/パーティー）の合成で導出＝新規列不要。**人手記入の④振り返り・学び/⑤次アクション/
KPI＋(c)自動要約キャッシュ**のみを本テーブルに保持（クエスト1件＝0..1）。

Revision ID: 0025_quest_outcomes
Revises: 0024_flatten_quest_groups
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0025_quest_outcomes"
down_revision = "0024_flatten_quest_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quest_outcomes",
        sa.Column("quest_id", UUID(as_uuid=True), sa.ForeignKey("quests.id"), primary_key=True),
        sa.Column("summary", sa.Text(), nullable=True),          # 成果（総括）
        sa.Column("learnings", sa.Text(), nullable=True),        # 学び・課題（ISO56001 §10）
        sa.Column("next_actions", sa.Text(), nullable=True),     # 次アクション
        sa.Column("metrics", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),  # 期待価値/成果の指標 [{label,value}]
        sa.Column("chat_summary", sa.Text(), nullable=True),     # (c) 自動要約（抽出型・オフライン）のキャッシュ
        sa.Column("chat_summary_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("quest_outcomes")
