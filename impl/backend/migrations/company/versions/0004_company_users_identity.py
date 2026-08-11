"""company: users に login_id/email/system_role 列を追加（accounts のミラー・データモデル §5.3）

会社DB 単独でユーザ一覧を描画（login_id/email/system_role 表示・API 往復回避）するためのミラー列。
源泉＝管理DB accounts。反映は §4.6 account_sync_outbox（発行/編集の payload）。
NULL 可＝ミラー未同期（本 migration 以前に作られた行）は NULL。以後 outbox/seed で埋まる
（データモデル §5.3 は NOT NULL だが、既存行の後方互換のため mirror 列は NULL 可とする）。

Revision ID: 0004_company_users_identity
Revises: 0003_company_last_login_at
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_company_users_identity"
down_revision = "0003_company_last_login_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("login_id", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("system_role", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "system_role")
    op.drop_column("users", "email")
    op.drop_column("users", "login_id")
