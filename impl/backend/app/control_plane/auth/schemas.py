"""認証 API のリクエスト/レスポンス スキーマ（§3.2 DTO）。

レスポンスモデルは OpenAPI に反映され、フロントの型付きクライアント codegen の入力になる。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    company_code: str = Field(min_length=1)
    login_id: str = Field(min_length=1)
    password: str = Field(min_length=1)


class SessionUser(BaseModel):
    user_id: str | None
    display_name: str
    avatar_url: str | None = None


class Session(BaseModel):
    """A.6 セッションスキーマ（GET /auth/session の応答・login authenticated 応答に内包）。"""

    account_id: str
    company_id: str
    company_code: str
    system_role: str
    locale: str
    user: SessionUser
    # ログイン時点で会社DBに有効な `quest_group_members.role=admin` を1つ以上持つか（QG管理者・B.4 ナビ出し分け）。
    # per-group の集計をセッションにスナップショット（system_role と同様・変更は再ログインで再評価）。
    is_qg_admin: bool = False


class MfaChallenge(BaseModel):
    """login `mfa_required` 応答の mfa（A.1・ADR-0004 §2.4）。実在は本人に既知（PW照合後）。"""

    delivery: str = "email"
    masked_to: str          # 送信先メールの伏字（例 y****@acme.co.jp）
    expires_in: int         # OTP 有効期限（秒）
    resend_available_in: int  # 次に resend 可能になるまでの秒


class LoginResponse(BaseModel):
    status: str  # "authenticated" | "mfa_required"
    session: Session | None = None
    mfa: MfaChallenge | None = None


class MfaVerifyReq(BaseModel):
    code: str = Field(min_length=1)
    trust_device: bool = False


class MfaResendResponse(BaseModel):
    expires_in: int
    resend_available_in: int


# --- 初回・再設定パスワード（A.7・状態B/D） ---------------------------------------------
class PasswordSetupRequestReq(BaseModel):
    company_code: str = Field(min_length=1)
    login_id: str = Field(min_length=1)


class AcceptedResponse(BaseModel):
    """常に同一（列挙耐性・A.7）。実際に送ったかは示さない。"""

    status: str = "accepted"


class PasswordSetupVerifyReq(BaseModel):
    token: str = Field(min_length=1)


class PasswordSetupVerifyResponse(BaseModel):
    valid: bool
    login_id: str


class PasswordSetupCompleteReq(BaseModel):
    token: str = Field(min_length=1)
    new_password: str = Field(min_length=1)  # 具体ポリシーは domain で検証（ADR-0002 §2.2）


class OkResponse(BaseModel):
    status: str = "ok"
