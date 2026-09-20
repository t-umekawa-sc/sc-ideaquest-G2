"""ドメイン N（情報インプット）の API DTO（Pydantic・§3.2 DB モデル直返し禁止）。

一覧（SC-50）＝カード配列＋番号ページャ page_info（§1.8.1・DataTable サーバー委譲＝quest-catalog と同形）。
内部列（archived_at 等）や本文（body_html/body_text）は一覧では露出しない（詳細＝Phase B の GET /info-items/{id}）。
アバターはキー直返し禁止＝短TTL 署名URL（`avatar_image_url`・§1.10）。
"""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

# フィルタ/入力検証のホワイトリスト（データモデル §3 info_* enum・labels.ts と一致）。
STATUS_VALUES: frozenset[str] = frozenset({"raw", "curated", "archived"})
PRIORITY_VALUES: frozenset[str] = frozenset({"highest", "high", "normal", "low", "lowest"})
SOURCE_VALUES: frozenset[str] = frozenset({
    "public_data", "market_research", "news", "event", "customer", "personal",
    "competitor", "investor", "org_decision", "employee", "legal", "research", "other",
})
IMPACT_CLASS_VALUES: frozenset[str] = frozenset({"opportunity", "threat", "other"})


class InfoCreatorDTO(BaseModel):
    user_id: str
    display_name: str
    avatar_image_url: str | None = None


class InfoItemCardDTO(BaseModel):
    """一覧カード/行の1件（N.1・SC-50）。本文は含めない（要約のみ）。"""

    id: str
    parent_info_id: str | None = None
    title: str
    summary: str | None = None
    status: str
    priority: str | None = None
    source: str | None = None
    classification: str | None = None
    scope: str | None = None
    impact_class: str | None = None
    categories: list[str] = []
    source_url: str | None = None
    due_date: date | None = None
    created_by: InfoCreatorDTO
    created_at: datetime
    # 派生集計（サーバー算出・N+1 回避で一括取得）。link_count は未棄却リンクのみ（§5.35）。
    link_count: int = 0
    follow_up_count: int = 0  # 続報スレッド件数（一覧の 🧵N・§12-1）


class InfoOffsetPageInfo(BaseModel):
    """番号ページャの共通エンベロープ（§1.8.1・quest-catalog と同形）。"""

    total: int
    page: int
    per_page: int


class InfoStatusFacets(BaseModel):
    """状態タブの件数バッジ（SC-50・archived 除外・status 以外の現行フィルタ反映）。"""

    all: int
    raw: int
    curated: int


class InfoListResponse(BaseModel):
    data: list[InfoItemCardDTO]
    page_info: InfoOffsetPageInfo
    facets: InfoStatusFacets


class WordCloudTokenDTO(BaseModel):
    token: str
    count: int
    weight: float | None = None


class WordCloudResponse(BaseModel):
    tokens: list[WordCloudTokenDTO]


# ---- 登録（POST /info-items・N.2）-------------------------------------------
class InfoCreateRequest(BaseModel):
    """低摩擦登録（全ユーザー）／続報登録。属性は登録後に curator が PATCH（Phase C 後続）。"""

    title: str
    body_html: str | None = None
    source_url: str | None = None
    parent_info_id: str | None = None  # 続報＝親情報ID（§12-1）


class InfoUpdateRequest(BaseModel):
    """部分更新（PATCH）。**内容＝作成者のみ**（title/body_html/source_url）／**キュレーション＝curator のみ**。

    どのフィールドが送られたかは `model_fields_set` で判定（null 明示とキー未送信を区別）。越権フィールドは 403。
    """
    # 内容（作成者・status 非依存）
    title: str | None = None
    body_html: str | None = None
    source_url: str | None = None
    # キュレーション（info_curator）
    priority: str | None = None
    source: str | None = None
    classification: str | None = None
    scope: str | None = None
    target_business: str | None = None
    impact_level: str | None = None
    impact_class: str | None = None
    impact_timing: str | None = None
    triaged_on: str | None = None
    triage: str | None = None
    triage_reason: str | None = None
    categories: list[str] | None = None


# ---- 詳細（GET /info-items/{id}・N.1・SC-52）---------------------------------
class InfoCanDTO(BaseModel):
    """閲覧者の編集能力（サーバー算出・N.0）。内容=作成者／キュレーション=curator／リンク=全員。"""

    edit_content: bool
    curate: bool
    add_link: bool


class InfoLinkDTO(BaseModel):
    id: str
    target_type: str
    target_id: str
    target_title: str | None = None  # ideas/quests から解決（未実装ドメイン/不在は None）
    kind: str
    origin: str
    score: float | None = None
    rejected: bool = False


class InfoThreadItemDTO(BaseModel):
    id: str
    title: str
    created_by: str | None = None
    created_at: datetime


class InfoThreadDTO(BaseModel):
    parent: InfoThreadItemDTO | None = None
    follow_ups: list[InfoThreadItemDTO] = []


class InfoDetailDTO(BaseModel):
    id: str
    parent_info_id: str | None = None
    title: str
    body_html: str | None = None
    summary: str | None = None
    source_url: str | None = None
    due_date: date | None = None
    status: str
    priority: str | None = None
    source: str | None = None
    classification: str | None = None
    scope: str | None = None
    target_business: str | None = None
    impact_level: str | None = None
    impact_class: str | None = None
    impact_timing: str | None = None
    triaged_on: date | None = None
    triage: str | None = None
    triage_reason: str | None = None
    categories: list[str] = []
    created_by: InfoCreatorDTO
    created_at: datetime
    updated_at: datetime
    links: list[InfoLinkDTO] = []
    thread: InfoThreadDTO
    tokens_top: list[WordCloudTokenDTO] = []
    can: InfoCanDTO
