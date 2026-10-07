"""公開プレーン（セルフサインアップ）の入出力 DTO（API設計 A §A.11.2-A.11.3）。"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

# 簡易 email 形式（外部依存 email-validator を増やさない・既存 admin/me も plain str 運用）。
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(v: str) -> str:
    v = v.strip()
    if not _EMAIL_RE.match(v):
        raise ValueError("メールアドレスの形式が正しくありません。")
    return v


class BootstrapResponse(BaseModel):
    # デプロイ既定会社コード（env IQ_DEFAULT_COMPANY_CODE）。あれば SC-00 の会社コード欄を隠して自動セット。
    default_company_code: str | None = None
    # 既定会社があり self_signup_enabled=true の時のみ true（会社コードを隠す public デプロイのUI出し分け用）。
    self_signup_available: bool = False
    # CAPTCHA（Turnstile）site key（公開）。設定時のみフロントがウィジェットを出す。未設定は null（CAPTCHA 無効）。
    turnstile_site_key: str | None = None


class SignupRequest(BaseModel):
    # public デプロイで既定会社コードがある場合は省略可（サーバーが env 値で補完）。
    company_code: str | None = None
    login_id: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=3, max_length=255)
    display_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=256)  # 最低文字数（SEC D）
    captcha_token: str | None = None  # Turnstile トークン（CAPTCHA 有効時のみ必須・SEC G）

    _v_email = field_validator("email")(_validate_email)


class SignupAcceptedResponse(BaseModel):
    # 列挙耐性のため成否に関わらず一律 202・同一形（SEC B）。
    status: str = "verification_sent"
    masked_to: str
    expires_in: int
    resend_available_in: int


class SignupVerifyRequest(BaseModel):
    company_code: str | None = None
    email: str = Field(min_length=3, max_length=255)
    code: str = Field(min_length=1, max_length=12)

    _v_email = field_validator("email")(_validate_email)


class SignupCreatedResponse(BaseModel):
    # 確定成功＝自動ログインしない（SEC I）。SC-00 ログインへ会社コード/ログインIDをプリフィル誘導。
    status: str = "created"
    company_code: str
    login_id: str
