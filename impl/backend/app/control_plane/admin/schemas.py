"""`/admin/*` の入出力 DTO（Pydantic・§3.2 DB モデル直返し禁止・§B.6 不要項目を返さない）。"""
from __future__ import annotations

import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_COMPANY_CODE_RE = re.compile(r"[A-Z][A-Z0-9-]{3,19}")  # 英大文字始まり・A-Z/0-9/-・4〜20字（§4.1）
_MAX_MEMBERSHIPS = 100  # 発行/編集で一度に指定できる所属の件数上限（Mass Assignment 抑止・B.2）


class MembershipInput(BaseModel):
    """初期所属/所属差分の 1 要素（会社DB `quest_group_members`・B.2/B.3/B.5）。

    `role=admin`＝QG管理者任命（system_admin＋会社アカウント管理者が可・B.2.1）。想定外プロパティ拒否。
    """
    model_config = ConfigDict(extra="forbid")

    group_id: uuid.UUID
    role: Literal["member", "admin"] = "member"


class PageInfo(BaseModel):
    """オフセットページングの page_info（README §1.8）。"""
    total: int
    page: int
    per_page: int


class AccountListItem(BaseModel):
    """アカウント一覧の 1 行（SC-92・B.2）。`password_hash` 等の機密は含めない（§B.6）。

    所属グループ/グループ内ロール（会社DB `quest_group_members`）は後続スライスで付与する。
    """
    account_id: str
    display_name: str
    login_id: str
    email: str
    system_role: str
    status: str
    last_login_at: str | None = None


class AccountListResponse(BaseModel):
    data: list[AccountListItem]
    page_info: PageInfo


class AccountCreateRequest(BaseModel):
    """アカウント発行の入力（B.2・SC-92）。想定外プロパティは拒否（Mass Assignment 防止・§B.6）。

    `system_role` は enum 限定（`quest_group_admin` は不受理）。`memberships`＝初期所属（会社DB
    `quest_group_members`）を発行 Tx で outbox payload へ相乗（B.5 step3）。`role=admin` 可（B.2）。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, max_length=255)
    login_id: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=1, max_length=255)
    system_role: Literal["general", "company_account_admin", "system_admin"] = "general"
    locale: Literal["ja", "en"] = "ja"
    memberships: list[MembershipInput] = Field(default_factory=list, max_length=_MAX_MEMBERSHIPS)


class AccountUpdateRequest(BaseModel):
    """アカウント編集の入力（差分・B.2）。未指定フィールドは変更しない（`model_dump(exclude_unset=True)`）。

    想定外プロパティは拒否（Mass Assignment 防止・§B.6）。`memberships` を指定すると希望有効所属の
    全集合として差分適用（会社DB `quest_group_members` を直接 upsert/トゥームストーン・B.3）。未指定は所属に触れない。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    login_id: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, min_length=1, max_length=255)
    system_role: Literal["general", "company_account_admin", "system_admin"] | None = None
    memberships: list[MembershipInput] | None = Field(default=None, max_length=_MAX_MEMBERSHIPS)


class AccountCreateSelfRequest(BaseModel):
    """会社アカウント管理者の発行入力（B.2.1）。**`system_role` は受け取らない**＝作れるのは
    `general` のみ（ロール付与は system_admin に集約・§8-⑯）。想定外プロパティは拒否（§B.6）。
    ただし `memberships` の `role=admin`（QG管理者任命）は自社スコープで可（B.2.1・2026-08-02 改定）。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, max_length=255)
    login_id: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=1, max_length=255)
    locale: Literal["ja", "en"] = "ja"
    memberships: list[MembershipInput] = Field(default_factory=list, max_length=_MAX_MEMBERSHIPS)


class AccountUpdateSelfRequest(BaseModel):
    """会社アカウント管理者の編集入力（B.2.1・差分）。**`system_role` は変更不可**（受け取らない）。
    `memberships` は自社スコープで差分適用可（`role=admin` の任命/剥奪も可・B.2.1・2026-08-02）。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    login_id: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, min_length=1, max_length=255)
    memberships: list[MembershipInput] | None = Field(default=None, max_length=_MAX_MEMBERSHIPS)


class AccountResponse(BaseModel):
    """発行/編集/状態変更結果のアカウント（機密は含めない・§B.6）。"""
    account_id: str
    display_name: str
    login_id: str
    email: str
    system_role: str
    status: str
    password_set: bool


class PasswordResetResponse(BaseModel):
    """PWリンク再送の結果（A.7）。"""
    status: str  # "sent"


# --- 会社 CRUD（B.1・SC-91/92） -------------------------------------------------------------
class CompanyListItem(BaseModel):
    """会社一覧の 1 行（SC-91）。group_count（会社DB `quest_groups`）はドメインC実装時に付与。"""
    company_id: str
    company_code: str
    name: str
    db_identifier: str
    status: str
    color: str
    icon_image_path: str | None = None
    account_count: int


class CompanyListResponse(BaseModel):
    data: list[CompanyListItem]
    page_info: PageInfo


class CompanyDetail(BaseModel):
    """会社詳細＋設定フラグ＋件数（SC-92）。"""
    company_id: str
    company_code: str
    name: str
    db_identifier: str
    status: str
    color: str
    icon_image_path: str | None = None
    mfa_required: bool
    vote_anonymized: bool
    hide_voters_from_managers: bool
    account_count: int


class CompanyCreateRequest(BaseModel):
    """会社作成の入力（SC-91）。`company_code` は大文字正規化＋形式検証（§4.1）。想定外プロパティ拒否。"""
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    company_code: str
    db_identifier: str = Field(min_length=1, max_length=128)
    color: str | None = Field(default=None, max_length=16)
    icon_image_path: str | None = Field(default=None, max_length=512)

    @field_validator("company_code")
    @classmethod
    def _normalize_code(cls, v: str) -> str:
        v = v.strip().upper()  # 大小文字は区別しない＝大文字へ正規化（§4.1）
        if not _COMPANY_CODE_RE.fullmatch(v):
            raise ValueError("company_code は英大文字始まり・A-Z/0-9/- ・4〜20字")
        return v


class CompanyProfileUpdateRequest(BaseModel):
    """会社プロフィール更新（SC-92・差分）。company_code/db_identifier は不変（受け取らない）。"""
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    color: str | None = Field(default=None, max_length=16)
    icon_image_path: str | None = Field(default=None, max_length=512)


class CompanySettingsUpdateRequest(BaseModel):
    """会社設定フラグ更新（SC-92・差分）。"""
    model_config = ConfigDict(extra="forbid")

    vote_anonymized: bool | None = None
    hide_voters_from_managers: bool | None = None
    mfa_required: bool | None = None


# --- QG管理者 API（B.4・SC-90） ------------------------------------------------------------
class QuestGroupListItem(BaseModel):
    """自分が `admin` のグループ 1 行（SC-90 グループ切替）。"""
    group_id: str
    quest_group_code: str
    name: str
    member_count: int


class QuestGroupListResponse(BaseModel):
    data: list[QuestGroupListItem]


class MemberListItem(BaseModel):
    """グループの参加メンバー 1 行（`quest_group_members`×`users`）。機密は含めない（§B.6）。"""
    account_id: str
    display_name: str
    role: str


class MemberListResponse(BaseModel):
    data: list[MemberListItem]


class MemberAddRequest(BaseModel):
    """参加追加の入力（B.4）。既存アカウントをディレクトリで選択。想定外プロパティ拒否（§B.6）。

    **`role` は受け取らない**＝QG管理者の参加追加は `role=member` 固定（`admin` 任命は不可・§8-⑯）。
    """
    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID


class MembershipResponse(BaseModel):
    """参加追加の結果（会社DB `quest_group_members` の 1 行）。"""
    account_id: str
    group_id: str
    role: str


class DirectoryItem(BaseModel):
    """自社ディレクトリの 1 行（B.4・**最小射影**＝PII/role/組織構造は出さない）。"""
    account_id: str
    display_name: str
    avatar_url: str | None = None


class DirectoryResponse(BaseModel):
    data: list[DirectoryItem]
    page_info: PageInfo
