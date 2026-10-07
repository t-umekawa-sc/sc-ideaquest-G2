"""管理DB（コントロールプレーン）のモデル。

ログイン状態A スライスに必要な最小列のみ（データモデル §4 の部分集合）。
identity（login_id/email/locale/display_name）の源泉は accounts（§1.13・ADR/K）。
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
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
    # 会社設定/プロフィール（B.1・SC-92・データモデル §4.1）
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="#6366F1")  # プリセット hex
    icon_image_path: Mapped[str | None] = mapped_column(String(512), nullable=True)    # MinIO キー・任意
    vote_anonymized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hide_voters_from_managers: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    mfa_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # ゲームモード会社既定（レビュー#2・デザイン標準 §4.11）。true＝ゲーム層UIあり（現行挙動）。
    # 実効値は個人上書き優先＝accounts.game_mode_override ?? 本既定（未上書きユーザーは本既定に追従）。
    game_mode_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 業務通知メールの会社既定（FR-40／SC-92・§4）。true＝送る（既定）。参加リクエスト等の業務メールをゲート。
    # セキュリティ系メール（PW/新端末/ロック・A.9-⑧）は本トグルの対象外＝常時送信。
    notify_email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # 自動関連付け（N.6・§5.36b）の一致率しきい値（会社別・SC-92）。cosine 類似度 0..1・既定 0.120（=12%）。
    # 高いほど厳しく（リンクが減る）、低いほど緩い（増える）。auto-link は本値以上で自動リンクを生成。
    auto_link_threshold: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False, default=Decimal("0.120"), server_default="0.120")
    # 経営資料整合の類似度方式（会社別・FR-44・SC-92・A-2）。keyword=キーワード一致／embedding=意味（埋め込み）／
    # hybrid=両者の加重（式は config・会社UIには出さない）。既定 keyword（検証後に切替）。変更で整合率を全再計算。
    alignment_method: Mapped[str] = mapped_column(String(16), nullable=False, default="keyword", server_default="keyword")
    # 公開/非公開モード（FR-48・設計 §8.0）。private=従来＋コンテスト／public(デモ)=role=general はコンテスト系以外 403・
    # SC-53 着地（SC-01 非表示）。管理者は例外（決定O）。authz/メニュー/導線の権威。既定 private。
    access_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="private", server_default="private")
    # セルフサインアップ許可（FR-48・決定M）。true の会社のみ公開サインアップ可（public/private 問わず opt-in）。既定 false。
    self_signup_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Account(ControlBase):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("company_id", "login_id", name="uq_accounts_company_login"),
        UniqueConstraint("company_id", "email", name="uq_accounts_company_email"),  # 会社内一意（§4.2）
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    login_id: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    # メール変更（K.3・ADR-0008）の確定待ち新メール。確認リンク到達で email へ確定しクリア。一意制約なし（確定時に再検証）
    pending_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 現 email の到達/所有確認済み日時（ADR-0009）。未確認は NULL。email が変わったら必ず NULL リセット。
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)  # identity 源泉（K/1b）
    # password_hash が NULL＝password_set=false（初回未設定）。列挙耐性のため照合は必ず実行（A.1）
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="ja")  # ja | en
    # アニメ演出のユーザー別 OFF（デザイン標準 §4.9）。true＝この人は演出を抑制。実効=OS reduce OR 本フラグ。
    reduce_motion: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # ダッシュボードのアバター追従アニメの表示 ON/OFF（暫定マスコット #20・§4.9 系）。true＝表示（既定＝現行挙動）。
    # 実効表示 = 追従ON かつ 非抑制（reduce_motion＝OS reduce OR 個別設定 が立てば追従も出さない）。目立つ演出のため個別に切れる。
    mascot_follow: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # ゲームモード個人上書き（レビュー#2・§4.11）。三値＝NULL(=会社既定に従う)/True(ON)/False(OFF)。
    # 実効値 = game_mode_override ?? companies.game_mode_default（個人が非NULLなら優先）。account-only（users へミラーしない）。
    game_mode_override: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)
    system_role: Mapped[str] = mapped_column(String(32), nullable=False, default="general")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")  # active | disabled
    # ログイン成功時に更新（源泉）→ 会社DB users.last_login_at へ §4.6 outbox でミラー
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)  # login | password_setup | email_change | email_verify
    # email_verify（ADR-0009）が束ねる送信時の email スナップショット。confirm で現 email と照合し不一致は 409 stale。
    target_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SignupChallenge(ControlBase):
    """セルフサインアップの検証前 pending（データモデル §4.4a・FR-48②・SEC A）。

    決定A＝メール認証成功まで `accounts` を作らない。`otp_challenges` は account_id NOT NULL ＋
    pending 入力列が無く流用不可のため専用テーブル。検証前の入力（会社/希望ログインID/メール/表示名/
    PWハッシュ）と 6桁OTP を**アカウント不在のまま**束ねて保持する。
    - `password_hash`＝Argon2id 済み（平文/ログ出力禁止・SEC D）。`code_hash`＝6桁OTP の SHA-256（SEC C）。
    - `attempts`＝上限で失効（OTP ブルートフォース対策・SEC C）。`expires_at`＝10 分。
    - `used_at`＝確定成功で打刻し単回（再利用は 410・SEC A/C）。
    - 一意制約は置かない（一意性は確定時の `accounts` INSERT が権威＝スクワッティング防止・決定A）。
    """

    __tablename__ = "signup_challenges"
    __table_args__ = (
        Index("ix_signup_challenges_company_email", "company_id", "email"),
        Index("ix_signup_challenges_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False
    )
    login_id: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)  # Argon2id（平文保持しない）
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)  # 6桁OTP の SHA-256 hex
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
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
