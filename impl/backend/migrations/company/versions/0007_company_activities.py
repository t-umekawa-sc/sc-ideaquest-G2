"""company: activities（XP/コイン/SP 履歴・付与/消費の元帳）を新設（データモデル §5.27）

G の台帳 canonical。付与/消費は必ず `activities` 追記＋`users` 残高更新を同一Tx で行う（§7・残高整合）。
`kind`/`ref_type` は論理 enum（データモデル §3）だが、本リポジトリの規約に倣い String 列で保持
（既存 `users.status`/`system_role` と同方針＝ネイティブ enum のマイグレーション負荷を避ける）。
`user_id` は同一DB内 FK（監査保持のため ON DELETE RESTRICT）。`quest_id`/`ref_id` は多態/未実装ドメイン
参照のため物理 FK を張らない（整合はアプリ層・§5.27）。

Revision ID: 0007_company_activities
Revises: 0006_company_qg_soft_delete
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0007_company_activities"
down_revision = "0006_company_qg_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),   # xp_gain/coin_gain/coin_spend/sp_gain/sp_spend
        sa.Column("amount", sa.Integer(), nullable=False),  # 消費も正の量＋kind で方向（§5.27）
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column("quest_id", UUID(as_uuid=True), nullable=True),   # FK なし（quests 未実装・多態）
        sa.Column("ref_type", sa.String(32), nullable=True),        # ref_id の参照先テーブル判別
        sa.Column("ref_id", UUID(as_uuid=True), nullable=True),     # FK なし（多態参照・§5.27）
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # §5.27 のインデックス（履歴/クエスト内ランキング/日次上限判定/逆引き）
    op.create_index("ix_activities_user_created", "activities", ["user_id", "created_at"])
    op.create_index("ix_activities_quest_created", "activities", ["quest_id", "created_at"])
    op.create_index("ix_activities_kind_reason_created", "activities", ["kind", "reason", "created_at"])
    op.create_index("ix_activities_ref", "activities", ["ref_type", "ref_id"])


def downgrade() -> None:
    op.drop_index("ix_activities_ref", table_name="activities")
    op.drop_index("ix_activities_kind_reason_created", table_name="activities")
    op.drop_index("ix_activities_quest_created", table_name="activities")
    op.drop_index("ix_activities_user_created", table_name="activities")
    op.drop_table("activities")
