"""company: コンテスト参加の自動承認フラグ（contests.auto_approve・FR-46・コンテスト単位で選べる）。

社内モード（access_mode=private）の Tier1 参加を、申請→管理者承認（既定）か、自動承認（オープン参加・誰でも即参加）
かを**コンテスト単位**で選べるようにする。既定 false＝従来どおり承認制（非破壊）。public/DEMO は本フラグに
関係なく常に自動承認（決定G）。

Revision ID: 0053_contest_auto_approve
Revises: 0052_contest_achievements
Create Date: 2026-10-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0053_contest_auto_approve"
down_revision = "0052_contest_achievements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("contests", sa.Column("auto_approve", sa.Boolean(), nullable=False,
                                        server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("contests", "auto_approve")
