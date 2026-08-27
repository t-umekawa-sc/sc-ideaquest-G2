"""company: 残高 CHECK(>=0) ＋ activities 付与冪等の部分ユニーク（監査 M6・並行防御）

データモデル §5「残高系は 0 以上を保証＝CHECK(>=0)」／API設計 F.4「部分ユニーク等で二重付与を防ぐ」。
- users.xp/coin_balance/skill_point_balance に CHECK(>=0)＝並行オーバースペンドの最終防御（負残高を DB で拒否）。
- activities に部分ユニーク UNIQUE(user_id,kind,reason,ref_type,ref_id) WHERE ref_id IS NOT NULL
  ＝付与の冪等（`exists_ref` の SELECT を抜けた並行 INSERT を DB で拒否）。ref_id NULL（login/levelup_sp）は
  日次で複数行入るため除外。既存データに重複・負残高が無いことを確認済み（追加時の失敗なし）。

Revision ID: 0020_company_balance_guards
Revises: 0019_company_avatar_base
Create Date: 2026-08-27

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_company_balance_guards"
down_revision = "0019_company_avatar_base"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint("ck_users_xp_nonneg", "users", "xp >= 0")
    op.create_check_constraint("ck_users_coin_nonneg", "users", "coin_balance >= 0")
    op.create_check_constraint("ck_users_sp_nonneg", "users", "skill_point_balance >= 0")
    op.create_index(
        "uq_activities_grant_ref", "activities",
        ["user_id", "kind", "reason", "ref_type", "ref_id"],
        unique=True, postgresql_where=sa.text("ref_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_activities_grant_ref", table_name="activities")
    op.drop_constraint("ck_users_sp_nonneg", "users", type_="check")
    op.drop_constraint("ck_users_coin_nonneg", "users", type_="check")
    op.drop_constraint("ck_users_xp_nonneg", "users", type_="check")
