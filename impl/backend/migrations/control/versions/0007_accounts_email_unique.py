"""control: accounts に会社内 email 一意制約を追加（データモデル §4.2 `UNIQUE(company_id, email)`）

login_id は既に `uq_accounts_company_login` があるが email 制約が ORM/DB に未実装だった差分を解消。
アカウント発行（B.2）の identity 一意検証（重複=409）を DB でも担保する。

Revision ID: 0007_accounts_email_unique
Revises: 0006_control_last_login_at
Create Date: 2026-08-11
"""
from alembic import op

revision = "0007_accounts_email_unique"
down_revision = "0006_control_last_login_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_accounts_company_email", "accounts", ["company_id", "email"])


def downgrade() -> None:
    op.drop_constraint("uq_accounts_company_email", "accounts", type_="unique")
