"""control: accounts.mascot_follow 列を追加（ダッシュボードのアバター追従アニメ表示 ON/OFF）

ダッシュボードでアバター（暫定＝アイコン #20）がカードに追従する演出のユーザー別 ON/OFF（K.2 プロフィール設定）。
true＝表示（既定＝現行挙動）。実効表示は「追従ON かつ 非抑制」＝reduce_motion（OS reduce OR 個別設定）が立てば
追従も出さない。かなり目立つ演出のため、動きを完全に止めたくないユーザーでも追従だけ切れるよう個別設定にする。
identity と同じく accounts が源泉（§4.2・K）。UI 個人設定＝会社DB users へはミラーしない（accounts のみで完結）。

Revision ID: 0014_accounts_mascot_follow
Revises: 0013_accounts_reduce_motion
Create Date: 2026-08-31

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_accounts_mascot_follow"
down_revision = "0013_accounts_reduce_motion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("mascot_follow", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("accounts", "mascot_follow")
