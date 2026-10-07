"""control: セルフサインアップの検証前 pending（signup_challenges・FR-48②・設計 §8.2・SEC A）。

決定A＝メール認証成功まで accounts を作らない。otp_challenges は account_id NOT NULL ＋
pending 入力列が無く流用不可のため専用テーブルを新設（データモデル §4.4a）。一意制約は置かない
（一意性は確定時の accounts INSERT が権威＝login_id/email スクワッティング防止）。PW は Argon2id 済み
を保持（平文保持しない・SEC D）、PII は表示名のみ（SEC J）。

（注: alembic_version.version_num は varchar(32)。revision id は 32 字以内。）

Revision ID: 0020_signup_challenges
Revises: 0019_company_access_mode
Create Date: 2026-10-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0020_signup_challenges"
down_revision = "0019_company_access_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "signup_challenges",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("login_id", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),  # Argon2id（平文保持しない）
        sa.Column("code_hash", sa.String(length=128), nullable=False),  # 6桁OTP の SHA-256
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # 再送/既存判定の引き（company+email）と DB 化時のバッチ削除用（expires_at）。一意制約は置かない。
    op.create_index("ix_signup_challenges_company_email", "signup_challenges", ["company_id", "email"])
    op.create_index("ix_signup_challenges_expires_at", "signup_challenges", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_signup_challenges_expires_at", table_name="signup_challenges")
    op.drop_index("ix_signup_challenges_company_email", table_name="signup_challenges")
    op.drop_table("signup_challenges")
