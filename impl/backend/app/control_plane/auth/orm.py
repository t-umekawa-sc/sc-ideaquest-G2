"""管理DB（コントロールプレーン）のモデル。

ログイン状態A スライスに必要な最小列のみ（データモデル §4 の部分集合）。
identity（login_id/email/locale/display_name）の源泉は accounts（§1.13・ADR/K）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ControlBase


class Company(ControlBase):
    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 会社DB の物理データベース名（§1.5 動的ルーティングの解決キー）
    db_identifier: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")  # active | suspended
    mfa_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Account(ControlBase):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("company_id", "login_id", name="uq_accounts_company_login"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    login_id: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)  # identity 源泉（K/1b）
    # password_hash が NULL＝password_set=false（初回未設定）。列挙耐性のため照合は必ず実行（A.1）
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ja")  # ja | en
    system_role: Mapped[str] = mapped_column(String(32), nullable=False, default="general")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")  # active | disabled
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OtpChallenge(ControlBase):
    """OTP チャレンジ（データモデル §4.4）。本スライスは purpose=`password_setup`（初回/再設定リンク）のみ。

    - `code_hash`＝設定リンクトークンの SHA-256（平文は保存しない・ADR-0002 §2.1）。
    - `expires_at`＝password_setup は発行から 72h（ADR-0002 §2.1）。
    - `used_at`＝単回。complete 成功で打刻し以後は無効（verify/complete とも 410）。
    - login（6桁 OTP・10分）は MFA スライスで同テーブルを purpose=`login` で利用する。
    """

    __tablename__ = "otp_challenges"
    __table_args__ = (Index("ix_otp_challenges_account_purpose", "account_id", "purpose"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)  # SHA-256 hex（トークンのハッシュ）
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)  # login | password_setup
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrustedDevice(ControlBase):
    """信頼端末（`iq_trust`・A.0/ADR-0004 §2.3）。MFA をスキップしてよい端末の登録。

    - `token_hash`＝`iq_trust` トークンの SHA-256（平文は保存しない・ADR-0002 §2.1 と同様）。
    - `expires_at`＝発行から 30日（`trusted_device_ttl_seconds`）。
    - `revoked`＝`logout-all` で全端末を失効（A.0-⑤）。login 照合は「未失効かつ未期限切れ」のみ有効。
    """

    __tablename__ = "trusted_devices"
    __table_args__ = (Index("ix_trusted_devices_account", "account_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
