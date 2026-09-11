"""`/me` の入出力 DTO（Pydantic・§3.2 DB モデル直返し禁止・§2.2 Mass Assignment 防止）。"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MeUpdateRequest(BaseModel):
    """プロフィール編集の入力（K.2・allowlist）。**`display_name`/`locale` のみ**受理。

    残高・`system_role`・`status`・`password_set`・`login_id`・`email` は編集不可＝想定外プロパティは
    拒否（extra=forbid＝Mass Assignment 防止・§2.2）。email/PW は K.3 の専用 EP（再認証）。
    """
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    locale: Literal["ja", "en"] | None = None
    # アニメ演出のユーザー別 OFF（デザイン標準 §4.9）。true＝抑制。OS reduce が最優先の下限（本値では ON に戻せない）。
    reduce_motion: bool | None = None
    # ダッシュボードのアバター追従アニメ表示 ON/OFF（#20・§4.9 系）。true＝表示。実効=追従ON かつ 非抑制。
    mascot_follow: bool | None = None
    # ゲームモード個人上書き（レビュー#2・§4.11）。**三値**＝True(ON)/False(OFF)/None(=会社既定に従う)。
    # None は「未指定（変更しない）」ではなく**明示的な上書きクリア**として受理する（router は exclude_unset で
    # 送信キーのみ渡す＝キーが有れば None でも set 扱い）。実効値 = 本値 ?? companies.game_mode_default。
    game_mode_override: bool | None = None


class MeAccountDTO(BaseModel):
    """identity（accounts 源泉・K.1）＝ログインID/メール/ロケール＋アニメ設定。"""
    login_id: str
    email: str
    locale: str
    reduce_motion: bool = False  # アニメ演出のユーザー別 OFF（§4.9・GET /me で配信・既定 false=演出あり）
    mascot_follow: bool = True  # アバター追従アニメ表示（#20・GET /me で配信・既定 true=表示＝現行挙動）


class MeProfileDTO(BaseModel):
    """プロフィール表示（K.1）。display_name は accounts 源泉。画像は署名URL（K.4・未設定は None）。"""
    display_name: str
    avatar_image_url: str | None = None
    idea_icon_image_url: str | None = None  # アイデア用アイコンの既定（アバターとは別・Phase 2・未設定は None）
    background_image_url: str | None = None
    avatar_base: str = "male"  # 3D アバターの男女2ベース（K.4.1・§5.3・既定 male）


class AvatarBaseUpdateRequest(BaseModel):
    """アバターベース体選択の入力（K.4.1・allowlist）。`base`（`male`/`female`）のみ受理。

    想定外プロパティ拒否（extra=forbid＝Mass Assignment 防止・§2.2）。将来 `animal_*` を追加（SC-31 §9.6）。
    """
    model_config = ConfigDict(extra="forbid")

    base: Literal["male", "female"]


class MeBalanceDTO(BaseModel):
    """残高（会社DB `users`・読み取り専用・canonical は G の activities・K.0）。

    `level`/`xp_to_next`/`level_span` は G の純粋レベル関数（データモデル §7）で `xp` から算出。
    """
    level: int
    xp: int
    xp_to_next: int
    level_span: int
    coin_balance: int
    skill_point_balance: int


class MeGameModeDTO(BaseModel):
    """ゲームモードの実効配信（レビュー#2・§4.11・K.1）。

    フロントは `effective` でゲーム層UIを gating し、SC-03 の3選セグメントは `override`（None=会社設定に従う）で
    選択状態を、`company_default` で「会社設定に従う（現在：ON/OFF）」の補足を描く。
    """
    effective: bool  # = override ?? company_default（gating の実効値）
    override: bool | None  # 個人上書き（三値・None=会社既定継承）
    company_default: bool  # 会社既定（companies.game_mode_default）


class MeResponse(BaseModel):
    """`GET /me`（正準・K.1）＝identity＋プロフィール＋残高＋ゲームモード。ダッシュボード hero も同読取（I.1 と両立）。"""
    account: MeAccountDTO
    profile: MeProfileDTO
    balance: MeBalanceDTO
    game_mode: MeGameModeDTO
    system_role: str


class MeActivityDTO(BaseModel):
    """活動履歴の1行（G の `activities` 元帳・G.6）。残高そのものではなく付与/消費の記録。

    `amount` は常に正・方向は `kind`（*_gain/*_spend）。`ref_type`/`ref_id` は多態参照（NULL 可・対でセット）。
    """
    id: str
    kind: str
    amount: int
    reason: str
    quest_id: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    created_at: datetime


class CursorPageInfo(BaseModel):
    """カーソルページングのページ情報（§1.8）。"""
    next_cursor: str | None = None
    has_next: bool


class MeActivitiesResponse(BaseModel):
    """`GET /me/activities`（履歴・G.6）＝カーソル一覧共通形（§1.8）。新しい順。"""
    data: list[MeActivityDTO]
    page_info: CursorPageInfo


class AvatarImageResponse(BaseModel):
    """`PUT /me/avatar-image` の応答（K.4）＝設定後の短TTL 署名URL。"""
    avatar_image_url: str


class IdeaIconImageResponse(BaseModel):
    """`PUT /me/idea-icon-image` の応答（K.4 流儀）＝設定後の短TTL 署名URL（アイデア用アイコン既定・Phase 2）。"""
    idea_icon_image_url: str


class BackgroundImageResponse(BaseModel):
    """`PUT /me/background-image` の応答（K.4）＝設定後の短TTL 署名URL。"""
    background_image_url: str


class PasswordChangeRequest(BaseModel):
    """自己パスワード変更の入力（K.3・現在PW 再認証）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class EmailChangeRequest(BaseModel):
    """自己メール変更の**要求**（K.3・現在PW 再認証・ダブルオプトイン ADR-0008）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    new_email: str = Field(min_length=1, max_length=255)
    current_password: str = Field(min_length=1)


class EmailChangeAcceptedResponse(BaseModel):
    """メール変更要求の受理応答（202・確定待ち・ADR-0008）。この時点では未反映。"""
    status: str = "accepted"


class EmailChangeConfirmRequest(BaseModel):
    """メール変更の**確定**（K.3・未認証＝トークンが認可・ADR-0008 §2.3）。想定外プロパティ拒否（§2.2）。"""
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1)


class EmailChangeConfirmedResponse(BaseModel):
    """メール変更確定の応答（200・ADR-0008）。未認証 EP のため identity 全体は返さない。"""
    status: str = "confirmed"
