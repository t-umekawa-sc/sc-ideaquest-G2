"""ドメイン N（情報インプット）の API DTO（Pydantic・§3.2 DB モデル直返し禁止）。

一覧（SC-50）＝カード配列＋番号ページャ page_info（§1.8.1・DataTable サーバー委譲＝quest-catalog と同形）。
内部列（archived_at 等）や本文（body_html/body_text）は一覧では露出しない（詳細＝Phase B の GET /info-items/{id}）。
アバターはキー直返し禁止＝短TTL 署名URL（`avatar_image_url`・§1.10）。
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

# フィルタ/入力検証のホワイトリスト（データモデル §3 info_* enum・labels.ts と一致）。
STATUS_VALUES: frozenset[str] = frozenset({"raw", "curated", "archived"})
PRIORITY_VALUES: frozenset[str] = frozenset({"highest", "high", "normal", "low", "lowest"})
SOURCE_VALUES: frozenset[str] = frozenset({
    "public_data", "market_research", "news", "event", "customer", "personal",
    "competitor", "investor", "org_decision", "employee", "legal", "research", "other",
})
IMPACT_CLASS_VALUES: frozenset[str] = frozenset({"opportunity", "threat", "other"})
LINK_TARGET_VALUES: frozenset[str] = frozenset({"ideas", "concepts", "quests", "assumptions"})
LINK_KIND_VALUES: frozenset[str] = frozenset({"related", "supporting", "refuting"})


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
    match_snippet: str | None = None  # 全文検索（q）時の一致箇所抜粋＝要約に無い語での一致も可視化（§1.11）
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
    """状態タブの件数バッジ（SC-50・status 以外の現行フィルタ反映）。all=raw+curated（非archived）／archived は別枠。"""

    all: int
    raw: int
    curated: int
    archived: int = 0


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
    """低摩擦登録（全ユーザー・タイトル/本文/出典）／続報登録。
    属性（キュレーション）は **登録者が info_curator の時のみ** 付与可（非curator が送ると 403・§85）。"""

    title: str
    body_html: str | None = None
    source_url: str | None = None
    parent_info_id: str | None = None  # 続報＝親情報ID（§12-1）
    # 属性（curator のみ・任意）＝送られた時だけ付与。付与すると status=raw→curated。
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
    due_date: str | None = None
    categories: list[str] | None = None


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
    due_date: str | None = None
    categories: list[str] | None = None


# ---- 関連リンク（/info-links・N.3）-----------------------------------------
class InfoLinkCreateRequest(BaseModel):
    """手動リンク追加（情報側＝会社内 active 全員・origin=manual）。"""

    info_item_id: str
    target_type: str
    target_id: str
    kind: str | None = None  # 既定 related


class InfoLinkKindRequest(BaseModel):
    kind: str  # related / supporting / refuting


class InfoLinkCandidateDTO(BaseModel):
    """リンク候補（成果物をタイトル検索して target_id を解決）。ideas/quests＝実装済ドメイン。
    対象ピッカー用に文脈メタ（同名識別）を付す＝所属クエスト名/起票者名/状態/期限
    （アイデア=time_limit・クエスト=deadline）。concepts/assumptions は未実装＝候補ゼロ。"""

    target_type: str
    target_id: str
    title: str
    quest_title: str | None = None
    owner_name: str | None = None
    status: str | None = None
    due: str | None = None  # ISO(YYYY-MM-DD)。アイデア=タイムリミット／クエスト=期限日。
    created_at: str | None = None  # ISO(YYYY-MM-DD)。同名・同一文脈でも作成日で識別できるように。


class InfoLinkCandidatesResponse(BaseModel):
    candidates: list[InfoLinkCandidateDTO]
    next_cursor: str | None = None  # ページング（もっと見る）。次が無ければ null。


# ---- 詳細（GET /info-items/{id}・N.1・SC-52）---------------------------------
class InfoCanDTO(BaseModel):
    """閲覧者の編集能力（サーバー算出・N.0）。内容=作成者／キュレーション=curator／リンク=全員。"""

    edit_content: bool
    curate: bool
    add_link: bool


class InfoCapabilitiesResponse(BaseModel):
    """現ユーザーの情報インプット権限（登録フォームの出し分け用）＝curator かどうか。"""
    can_curate: bool


class InfoLinkDTO(BaseModel):
    id: str
    target_type: str
    target_id: str
    target_title: str | None = None  # ideas/quests から解決（未実装ドメイン/不在は None）
    kind: str
    origin: str
    score: float | None = None
    rejected: bool = False


class RelatedInfoItemDTO(BaseModel):
    """成果物→関連情報パネルの1件（C.8b／D＝`GET /{quest,idea}/related-info`・FR-41）。"""

    link_id: str
    info_id: str
    title: str
    kind: str  # related / supporting / refuting（refuting は⚠）
    origin: str  # auto / manual
    score: float | None = None
    source_url: str | None = None
    impact_class: str | None = None  # opportunity / threat / other
    summary: str | None = None
    linked_by: InfoCreatorDTO | None = None  # manual のみ＝関連付けた人（auto は system＝None）


class RelatedInfoResponse(BaseModel):
    data: list[RelatedInfoItemDTO] = []


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
    attachments: list["InfoAttachmentDTO"] = []
    can: InfoCanDTO
    content_revisions: list["InfoRevisionDTO"] = []  # 内容の更新履歴（版/編集者/日時・§85・N.1）


class InfoRevisionDTO(BaseModel):
    """内容編集の版（🕘 更新履歴）＝版番号・編集者名・日時。新しい版が先頭。
    changed_fields＝前版比で変わったフィールド（初版は空・§85＝変更内容を見せる・アイデア D.4 と同型）。"""
    revision: int
    editor_name: str | None = None
    created_at: datetime
    changed_fields: list[str] = []


class InfoDiffSegment(BaseModel):
    """テキスト差分の1セグメント（§85）。op＝equal/add/del。"""
    op: Literal["equal", "add", "del"]
    text: str


class InfoDiffField(BaseModel):
    """フィールドごとの差分（§85）。kind=text は segments・kind=scalar は old/new。"""
    kind: Literal["text", "scalar"]
    segments: list[InfoDiffSegment] | None = None
    old: str | None = None
    new: str | None = None


class InfoRevisionDiffResponse(BaseModel):
    """版差分（§85・N.1）。fields＝変わったフィールドのみ（field 名→差分）。"""
    from_revision: int
    to_revision: int
    fields: dict[str, InfoDiffField]


class InfoImageUploadResponse(BaseModel):
    """貼付画像の再ホスト結果（POST /info-items/images・§12-4）＝自社ホスト（MinIO）署名URL。

    エディタの paste ハンドラが blob を送り、返った `url` で `img src` を置換する（外部参照を持ち込まない）。
    """
    url: str


class InfoAttachmentDTO(BaseModel):
    """参考資料（info 添付）のメタ（N.2・§5.33）＝内容群の一部。object_key/uploader_id 等の内部値は非露出（§3.2）。

    `url`＝短TTL 署名 URL（§1.10・詳細を閲覧できるユーザーが参照/ダウンロード可）。
    """
    id: str
    original_name: str
    size_bytes: int
    mime_type: str
    uploaded_by: InfoCreatorDTO
    uploaded_at: datetime
    url: str


class InfoAttachmentsResponse(BaseModel):
    """POST /info-items/{id}/attachments の応答（追加後の添付一覧・N.2）。"""
    attachments: list[InfoAttachmentDTO] = []


class InfoCuratorDTO(BaseModel):
    """情報判定権限（info_curator）の付与ユーザー（N.5）。管理面＝account_id で識別。"""
    account_id: str
    display_name: str
    granted_by: str | None = None
    granted_at: datetime


class InfoCuratorsResponse(BaseModel):
    """GET/POST /info-curators の応答（未剥奪の一覧・N.5）。"""
    data: list[InfoCuratorDTO] = []


class InfoCuratorGrantRequest(BaseModel):
    """POST /info-curators（付与・N.5）。対象は会社内アカウント（account_id）。"""
    account_id: str


# InfoDetailDTO.attachments は前方参照（InfoAttachmentDTO は後方定義）＝解決を明示。
InfoDetailDTO.model_rebuild()
