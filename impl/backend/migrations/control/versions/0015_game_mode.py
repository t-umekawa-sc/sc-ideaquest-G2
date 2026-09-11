"""control: ゲームモード列を追加（companies.game_mode_default／accounts.game_mode_override）

ゲーミフィケーションを望まない会社/個人向けにゲーム層UIを丸ごと出し分ける（レビュー#2・デザイン標準 §4.11）。
- companies.game_mode_default: 会社全体の既定 ON/OFF（NOT NULL・既定 true＝現行挙動）。SC-92 会社設定で編集。
- accounts.game_mode_override: 個人上書き（三値＝NULL(=会社既定に従う)/true/false）。SC-03 で編集。account-only
  （会社DB users へはミラーしない）。実効値 = game_mode_override ?? companies.game_mode_default（K.1 GET /me）。

Revision ID: 0015_game_mode
Revises: 0014_accounts_mascot_follow
Create Date: 2026-09-11

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_game_mode"
down_revision = "0014_accounts_mascot_follow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "companies",
        sa.Column("game_mode_default", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # 三値の個人上書き（NULL=会社既定に従う）。既存行は NULL＝会社既定を継承。server_default は張らない。
    op.add_column(
        "accounts",
        sa.Column("game_mode_override", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("accounts", "game_mode_override")
    op.drop_column("companies", "game_mode_default")
