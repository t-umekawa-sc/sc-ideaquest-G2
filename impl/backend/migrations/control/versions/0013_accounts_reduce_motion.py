"""control: accounts.reduce_motion 列を追加（アニメ演出のユーザー別 OFF 設定）

ゲーム感（juiciness）演出のユーザー別 ON/OFF（K.2 プロフィール設定）。true＝このユーザーは演出を抑制。
実効は「OS の prefers-reduced-motion **OR** 本フラグ」＝OS が最優先の下限（OS が reduce なら本フラグに関係なく
常に抑制・本フラグでは ON に戻せない）。既定 false（演出あり）。identity と同じく accounts が源泉（§4.2・K）。

Revision ID: 0013_accounts_reduce_motion
Revises: 0012_mail_outbox_params
Create Date: 2026-08-28

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_accounts_reduce_motion"
down_revision = "0012_mail_outbox_params"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("reduce_motion", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("accounts", "reduce_motion")
