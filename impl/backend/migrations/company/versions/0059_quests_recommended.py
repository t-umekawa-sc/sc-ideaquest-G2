"""company: quests に管理者お勧めフラグ `recommended`（データモデル §5.6・ダッシュボード再設計 Phase3）。

SC-01 ダッシュボードの「おすすめの参加可能クエスト」（Zone D）選出で、管理者（company_account_admin）が
優先露出させたいクエストに立てる per-quest フラグ。おすすめ選出スコア
`score = w_align·整合率 + w_active·直近活発 + w_admin·recommended` の **admin 成分**（加重和ブースト）。

- `recommended` boolean NOT NULL default false（お勧めは明示 opt-in）。既存行は false。
- 候補絞り（`recommended=true` の有効・公開クエスト）を素早く引くための部分索引を付す。

Revision ID: 0059_quests_recommended
Revises: 0058_ai_jobs_created_by
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa


revision = "0059_quests_recommended"
down_revision = "0058_ai_jobs_created_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quests",
        sa.Column("recommended", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # お勧めフラグの立った有効クエストだけを引く部分索引（おすすめ選出の候補絞り）。
    op.create_index(
        "ix_quests_recommended",
        "quests",
        ["recommended"],
        postgresql_where=sa.text("recommended AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_quests_recommended", table_name="quests")
    op.drop_column("quests", "recommended")
