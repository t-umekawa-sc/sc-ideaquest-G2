"""control: accounts.email_verified_at 列を追加（現アドレスの到達/所有確認済み日時）

管理者 opt-in のメールアドレス確認（ADR-0009）。現 `email` が確認済みになった日時を保持し、未確認は NULL。
`email` が変わったら必ず NULL リセット（管理者 PATCH／自己変更確定は now を刻む）。確認は `otp_challenges`
（`purpose=email_verify`・単回・TTL 72h）＋公開 confirm EP（`POST /auth/email-verify/confirm`）で縦通し。

Revision ID: 0011_accounts_email_verified
Revises: 0010_accounts_pending_email
Create Date: 2026-08-24

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内にする。）
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_accounts_email_verified"
down_revision = "0010_accounts_pending_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    # email_verify チャレンジが束ねる送信時 email（confirm で現 email と照合し不一致は 409 stale・ADR-0009 §2.1）
    op.add_column("otp_challenges", sa.Column("target_email", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("otp_challenges", "target_email")
    op.drop_column("accounts", "email_verified_at")
