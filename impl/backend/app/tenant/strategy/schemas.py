"""経営資料（strategy_documents）の DTO（API設計 R.1・データモデル §5.54）。

リクエストは `extra="forbid"`（想定外プロパティ拒否・§2.2）。doc_kind/status はホワイトリスト検証（application 層）。
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

DOC_KINDS = ("midterm_plan", "policy", "strategy", "other")


class StrategyDocCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    doc_kind: str = "other"
    intent: str | None = None
    policy_commitment: str | None = None
    strategy: str | None = None
    focus_areas: list[str] = Field(default_factory=list)
    objectives: str | None = None
    body_md: str | None = None
    period_from: date | None = None
    period_to: date | None = None


class StrategyDocUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    doc_kind: str | None = None
    intent: str | None = None
    policy_commitment: str | None = None
    strategy: str | None = None
    focus_areas: list[str] | None = None
    objectives: str | None = None
    body_md: str | None = None
    period_from: date | None = None
    period_to: date | None = None
    status: str | None = None  # active/archived（archive エンドポイントとは別に PATCH でも可）


class StrategyDocListItem(BaseModel):
    id: str
    title: str
    doc_kind: str
    status: str
    focus_areas: list[str]
    period_from: date | None
    period_to: date | None
    updated_at: datetime


class ImpactRates(BaseModel):
    """経営資料への情報の影響サマリ（R.4・詳細 read 同梱・決定的）。

    母集団＝当該資料とトークン関連度が `threshold` 以上の **curated（非アーカイブ）情報**。機会/脅威は
    `info_items.impact_class`（人手トリアージ）由来。専用テーブルは持たず read で集計（設計 §4.2）。
    """
    info_total: int          # 全 curated 情報数（影響率の分母）
    related_count: int       # 母集団＝関連度≥threshold の curated 情報数
    impact_rate: float       # related_count / info_total（方針に触れる情報がどれだけ入っているか・0..1）
    opportunity_count: int
    threat_count: int
    opportunity_rate: float  # opportunity_count / related_count（母集団のうち機会の割合・0..1）
    threat_rate: float       # threat_count / related_count（同・脅威の割合・0..1）
    threshold: float         # 使った関連度しきい値（説明可能性）


class StrategyDocDetail(BaseModel):
    id: str
    title: str
    doc_kind: str
    intent: str | None
    policy_commitment: str | None
    strategy: str | None
    focus_areas: list[str]
    objectives: str | None
    body_md: str | None
    period_from: date | None
    period_to: date | None
    status: str
    created_by: str | None  # display_name
    created_at: datetime
    updated_at: datetime
    impact: ImpactRates | None = None  # 詳細 read のみ同梱（R.4）。create/update/archive では None。


class StrategyDocSelectionItem(BaseModel):
    """クエストの適用資料 選択用 軽量表現（R.0・全文/率は返さない）。"""
    id: str
    title: str
    doc_kind: str
    period_from: date | None
    period_to: date | None


class PageInfo(BaseModel):
    page: int
    per_page: int
    total: int
    has_next: bool


class StrategyDocListResponse(BaseModel):
    data: list[StrategyDocListItem]
    page_info: PageInfo


class StrategyDocSelectionResponse(BaseModel):
    data: list[StrategyDocSelectionItem]


# ---- クエスト↔経営資料リンク（R.1b・§5.56） ----

class QuestLinkItem(BaseModel):
    id: str
    title: str
    status: str
    deadline: date | None = None      # 期限（締切）＝ピッカーの ⏳ バッジ・期限絞り込み
    owner_name: str | None = None     # 所有者（作成者）＝文脈行
    created_at: datetime | None = None  # 作成日時＝文脈行
    icon_image_url: str | None = None  # クエストアイコン（署名URL・ピッカー行頭表示／未設定は頭文字タイル）


class QuestLinkListResponse(BaseModel):
    data: list[QuestLinkItem]


class QuestLinkAddRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    quest_ids: list[str] = Field(min_length=1)
