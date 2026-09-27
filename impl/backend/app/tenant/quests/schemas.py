"""ドメイン C（クエスト）の API DTO（Pydantic・§3.2 DB モデル直返し禁止）。

一覧（SC-10）＝カード配列＋カーソル page_info（§1.8）。内部列（deleted_* 等）は露出しない。
画像はキー直返し禁止＝短TTL 署名URL（`*_image_url`・§1.10）で返す（会社アバターと同方針）。
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# クエスト内 6 権限（permission_type・§3/データモデル §5.9）。
PERMISSION_VALUES: frozenset[str] = frozenset(
    {"owner", "quest_admin", "evaluator", "vote", "idea_create", "comment"}
)


class QuestCursorPageInfo(BaseModel):
    """カーソルページングの共通エンベロープ（§1.8・me.CursorPageInfo と同形）。

    OpenAPI schema 名の衝突回避のため C ドメイン専用に命名（同名だと openapi-typescript が
    両者を完全修飾名にリネームし既存機能の型参照を壊すため）。
    """

    next_cursor: str | None = None
    has_next: bool


class QuestOwnerDTO(BaseModel):
    user_id: str
    display_name: str
    avatar_image_url: str | None = None


class QuestGroupRefDTO(BaseModel):
    id: str
    quest_group_code: str
    name: str


class QuestCardDTO(BaseModel):
    """一覧カード/行の1件（C.1・SC-10 §4.1）。"""

    id: str
    title: str
    color: str
    icon_image_url: str | None = None
    categories: list[str] = []
    status: str
    deadline: date | None = None
    member_count: int
    idea_count: int
    owner: QuestOwnerDTO
    # 参加部署（0..N・すべて同格・FR-38 再設計）。0 件なら空配列（単一 quest_group は廃止）。
    quest_groups: list[QuestGroupRefDTO] = []
    # 自分の状態＝draft（本人の下書き）/ member（参加中）。未投稿/投稿済みはドメイン D 実装後に精緻化。
    my_state: str
    # 閲覧者が作成者か（SC-01 で「自分のクエスト」を参加中と分離）。
    is_owner: bool = False
    # 発見カタログ掲載（FR-40・C.9.0）＝一覧の列/ソート/絞込・複製プリフィルに使う。
    discoverable: bool = False


class QuestListResponse(BaseModel):
    data: list[QuestCardDTO]
    page_info: QuestCursorPageInfo


# ---- 発見カタログ・フォロー・参加リクエスト（FR-40・C.9・SC-13） ----

class QuestCatalogCardDTO(QuestCardDTO):
    """発見カタログの1件＝カード＋メタ（`purpose`）。`my_state`＝member/pending/rejected/following/none。"""

    purpose: str | None = None


class QuestActivityDailyDTO(BaseModel):
    """発見カタログ活発度の1日分（メタのみ＝件数）。"""

    date: str
    count: int


class QuestActivityDTO(BaseModel):
    """発見カタログ活発度スパーク（C.9.1）＝クエスト横断の日次メッセージ数（メタ限定・本文は含まない）。"""

    daily: list[QuestActivityDailyDTO] = []
    total: int = 0
    days: int = 14


class QuestCatalogDetailDTO(QuestCatalogCardDTO):
    """発見カタログの詳細（SC-13 ダイアログ）＝カード＋メタ＋活発度スパーク。中身（本文/チャット/評価）は返さない。"""

    activity: QuestActivityDTO | None = None


class QuestOffsetPageInfo(BaseModel):
    total: int
    page: int
    per_page: int


class QuestCatalogResponse(BaseModel):
    data: list[QuestCatalogCardDTO]
    page_info: QuestOffsetPageInfo


class FollowResponse(BaseModel):
    following: bool


class JoinRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str | None = None


class JoinRequestResponse(BaseModel):
    status: str


class JoinRequestUserDTO(BaseModel):
    """参加リクエスト行の申請者メタ（C.9.1 GET /join-requests・アバター/氏名/所属バッジ）。"""

    user_id: str
    display_name: str
    avatar_image_url: str | None = None
    group_ids: list[str] = []


class JoinRequestRowDTO(BaseModel):
    """参加リクエスト1件（受信側＝SC-12 パーティータブ・C.9.1）。並びはフロント（pending 上位/rejected 下部）。"""

    user: JoinRequestUserDTO
    status: str
    message: str | None = None
    created_at: datetime
    decided_at: datetime | None = None


class JoinRequestListResponse(BaseModel):
    data: list[JoinRequestRowDTO]


class JoinRequestDecisionResponse(BaseModel):
    """承認/却下の応答（C.9.1）＝遷移後の状態。"""

    status: str


class JoinRequestProfileGameDTO(BaseModel):
    """申請者プロフィールのゲーム層（viewer のゲームモード ON 時のみ・C.9.1）＝3Dアバター/レベル/実績/ランキング。"""

    avatar_base: str          # "male"/"female"＝3D アバターのベース体
    level: int
    xp: int
    rank: int | None = None   # 総合ランキング順位（獲得 XP＋コイン・圏外/活動なしは null）
    rank_total: int = 0       # ランキング母数
    achievement_count: int = 0


class JoinRequestProfileDTO(BaseModel):
    """申請者プロフィール＝参加リクエスト承認の判断材料（C.9.1・owner/quest_admin のみ）。

    レピュテーション露出になりやすい「受けた評価の平均」は含めない（設計判断・出しすぎ回避）。
    """

    active_quest_count: int      # 現在有効参加中のクエスト数
    published_idea_count: int    # 投稿した公開アイデア数
    chat_message_count: int      # チャット投稿数
    game: JoinRequestProfileGameDTO | None = None  # viewer がゲームモード OFF なら null


class QuestGroupDTO(BaseModel):
    id: str
    quest_group_code: str
    name: str


class QuestGroupsResponse(BaseModel):
    """C.4 GET /quest-groups の応答（B ドメイン admin.QuestGroupListResponse と衝突しない一意名）。"""

    data: list[QuestGroupDTO]


# ---- 作成/編集/公開（SC-11・C.2/C.3）。request は extra=forbid で Mass Assignment 防止（§2.2/C.6） ----


class QuestMemberInput(BaseModel):
    """パーティーメンバー1件の入力（あるべき全体像の1要素・C.3）。permissions 省略時は既定を付与。"""

    model_config = ConfigDict(extra="forbid")

    user_id: str
    permissions: list[str] | None = None


class QuestCreateRequest(BaseModel):
    """POST /quests（C.2）。`owner_id`/`status` 以外の内部列は受けない（§1.4/C.6）。"""

    model_config = ConfigDict(extra="forbid")

    title: str
    color: str
    # 参加部署（アクセス条件・複数部署横断・FR-38 再設計）。フラット 0..N・すべて同格・省略/空も可（0 件＝会社全体）。
    # 主グループ（quest_group_id）は廃止＝受け付けない。
    quest_group_ids: list[str] = []
    categories: list[str] = []
    deadline: date | None = None
    purpose: str | None = None
    icon_image_path: str | None = None
    members: list[QuestMemberInput] = []
    # 作成＝下書き or 即公開。状態機械の前進は publish/transition のみ（recruiting 以降は不可）。
    status: Literal["draft", "recruiting"] = "draft"
    # 発見カタログ（SC-13）に載せて他部署から発見/フォロー/参加リクエストを許可するか（FR-40・C.9.0）。既定 false。
    discoverable: bool = False
    # 「この情報からクエストを作成」（SC-50・API N/C）＝指定時、作成したクエストへ info_link（関連・manual）を
    # 自動生成し「情報→機会特定→行動」の逆リンクを張る（§FR-41）。不在/他テナントは 422。
    from_info_id: str | None = None


class QuestUpdateRequest(BaseModel):
    """PATCH /quests/{id}（C.2）。差分＝送られたフィールドのみ適用（`model_fields_set` で判定）。

    `status` は受け付けない（状態遷移は publish/transition）＝フィールド自体を持たない。
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    color: str | None = None
    categories: list[str] | None = None
    deadline: date | None = None
    purpose: str | None = None
    icon_image_path: str | None = None
    members: list[QuestMemberInput] | None = None
    # 参加部署の「あるべき全体像」（フラット 0..N・すべて同格・FR-38 再設計）。送信時のみ差分適用。
    # 参加部署を外すのはブロックしない（409 group_in_use 廃止）＝門番の都度再判定で失効を表現（C.0/C.2）。
    quest_group_ids: list[str] | None = None
    # 発見カタログ（SC-13）への掲載可否のトグル（FR-40・C.9.0）。送信時のみ更新（owner/quest_admin）。
    discoverable: bool | None = None


class QuestPublishRequest(BaseModel):
    """POST /quests/{id}/publish（C.2）。内容フィールドは省略可（未送信は現在値）＋任意の members。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    color: str | None = None
    categories: list[str] | None = None
    deadline: date | None = None
    purpose: str | None = None
    icon_image_path: str | None = None
    members: list[QuestMemberInput] | None = None


class QuestMemberDTO(BaseModel):
    """パーティーメンバー1件の応答（C.1 GET .../members と同形・SC-11/SC-12 で再利用）。"""

    user: QuestOwnerDTO
    permissions: list[str] = []
    joined_at: datetime
    is_creator: bool
    # 参加部署アクセス可否（作成者別格 or 参加部署0件 or 参加部署に現所属）。false＝**参加部署外＝失効中**（FR-38・C.0）。
    in_scope: bool = True
    # 当該メンバーが有効所属する全クエストグループ（会社内・照会条件に限らず全件）。SC-11 のメンバーチップに
    # グループを常時表示し、フォームで参加グループを変更した際にクライアントが in_scope を即時再判定する材料（req2/3）。
    group_ids: list[str] = []
    # 参加リクエスト経由で参加したメンバー（承認済み jr が存在）＝SC-12 で「リクエスト経由」バッジ表示（FR-40・C.9）。
    via_request: bool = False


class QuestDetailDTO(BaseModel):
    """作成/編集/公開の応答＝クエスト詳細（カード項目＋purpose/created_at＋自分の権限＋パーティー）。"""

    id: str
    title: str
    color: str
    icon_image_url: str | None = None
    categories: list[str] = []
    status: str
    deadline: date | None = None
    purpose: str | None = None
    member_count: int
    idea_count: int
    owner: QuestOwnerDTO
    # 参加部署（0..N・すべて同格・created_at 昇順・FR-38 再設計）。0 件なら空配列（単一 quest_group は廃止）。
    quest_groups: list[QuestGroupRefDTO] = []
    my_state: str
    # 自分が持つ 6 権限（フロントの UX 出し分け・実アクションは各 EP で再検証・C.1）。
    my_permissions: list[str] = []
    members: list[QuestMemberDTO] = []
    created_at: datetime
    # 発見カタログ掲載可否（SC-11 編集フォームのトグル プリフィル・FR-40・C.9.0）。
    discoverable: bool = False
    # 定義の最新版番号（更新履歴リンク用・0＝未編集＝リンク非表示・§3.1）。
    current_revision: int = 0


class QuestIconImageResponse(BaseModel):
    """PUT/DELETE /quests/{id}/icon-image の応答＝設定後の短TTL 署名URL（削除時は None・K.4 流儀）。"""

    icon_image_url: str | None = None


class QuestCandidateDTO(BaseModel):
    """パーティー候補ユーザー1件（C.4 GET /quest-groups/{id}/members・GET /quest-group-candidates）。"""

    user_id: str
    display_name: str
    avatar_image_url: str | None = None
    # 横断候補（FR-38）で、本人が有効所属する全クエストグループ id（会社内・照会条件に限らず全件・所属バッジ常時表示用）。
    # 全社（照会0件）や単一グループ照会でも所属を示せるよう「照会との積集合」ではなく全件に統一（req2/5）。
    # 単一グループ EP では空（クライアントは group_id 既知のため不要）。
    group_ids: list[str] = []


class QuestCandidatesResponse(BaseModel):
    data: list[QuestCandidateDTO]
    page_info: QuestCursorPageInfo


# ---- パーティー粒度（C.3）／状態遷移（C.5）。request は extra=forbid（§2.2） ----


class QuestMembersResponse(BaseModel):
    """GET /quests/{id}/members・PUT /quests/{id}/party の応答（パーティー一覧・C.1/C.3）。"""

    data: list[QuestMemberDTO]


class QuestPartyUpdateRequest(BaseModel):
    """PUT /quests/{id}/party（C.3）＝あるべき全体像で一括差分適用。"""

    model_config = ConfigDict(extra="forbid")

    members: list[QuestMemberInput] = []


class QuestMemberAddRequest(BaseModel):
    """POST /quests/{id}/members（C.3・増分）。permissions 省略時は既定を付与。"""

    model_config = ConfigDict(extra="forbid")

    user_id: str
    permissions: list[str] | None = None


class QuestMemberPermissionsRequest(BaseModel):
    """PUT /quests/{id}/members/{user_id}/permissions（C.3）＝権限セット置換。"""

    model_config = ConfigDict(extra="forbid")

    permissions: list[str] = []


class QuestPermissionsResponse(BaseModel):
    """権限置換後の権限配列（C.3 PUT .../permissions）。"""

    permissions: list[str] = []


class QuestTransitionRequest(BaseModel):
    """POST /quests/{id}/transition（C.5）＝前進のみの状態遷移。"""

    model_config = ConfigDict(extra="forbid")

    to: str


# ---- クエスト最終結果＝アイデア選別の申し送り（FR-39・ISO 56001・完了時）。 ----


class QuestResultDecisionDTO(BaseModel):
    """公開アイデア1件の意思決定行（③）＝選定/不選定＋検証（評価集計）。①選定アイデアも本DTOの is_selected で抽出。"""

    idea_id: str
    title: str
    value: str | None = None
    author: QuestOwnerDTO
    is_selected: bool = False
    overall_avg: float | None = None  # 可視な submitted 評価の総合平均（可視0は None・F.1）
    evaluation_count: int = 0         # 可視な submitted 評価数


class QuestResultAspectAveragesDTO(BaseModel):
    """観点別平均（②評価・選別サマリ・ISO56001 §9）。可視な submitted 評価の観点別平均（可視0は None）。"""

    novelty: float | None = None
    impact: float | None = None
    feasibility: float | None = None
    fit: float | None = None
    cost: float | None = None


class QuestResultParticipationDTO(BaseModel):
    """参加・評価サマリ（②・定量指標）。"""

    idea_count: int = 0        # 公開アイデア数
    selected_count: int = 0    # 選定数
    vote_total: int = 0        # 投票総数（公開アイデア横断）
    evaluation_count: int = 0  # 可視な submitted 評価総数
    party_size: int = 0        # 有効パーティー人数（作成者含む）


class QuestOutcomeMetricDTO(BaseModel):
    """KPI/成果指標の1行（自由記述・⑤）。"""

    label: str = ""
    value: str = ""


class QuestOutcomeDTO(BaseModel):
    """人手記入の総括（④振り返り・⑤次アクション・KPI・(c)要約キャッシュ）。未記入は各 None/空。"""

    summary: str | None = None
    learnings: str | None = None
    next_actions: str | None = None
    metrics: list[QuestOutcomeMetricDTO] = []
    chat_summary: str | None = None
    chat_summary_at: datetime | None = None
    updated_by_name: str | None = None
    updated_at: datetime | None = None


class QuestResultPinnedMessageDTO(BaseModel):
    """④議論の要点(b)＝ピン留めされたチャット重要メッセージ（アイデア横断・pinned_at 昇順）。"""

    message_id: str
    idea_id: str
    idea_title: str
    author: QuestOwnerDTO
    excerpt: str
    created_at: datetime


class QuestResultAdoptedInfoDTO(BaseModel):
    """⑥採用された関連情報（FR-41 Phase2）＝クエスト＋配下アイデアで採用（adopted）した情報＋処理メモ。"""

    link_id: str
    info_id: str
    title: str
    kind: str
    source_url: str | None = None
    note: str | None = None  # どう処理・反映したか
    disposed_by: QuestOwnerDTO | None = None
    disposed_at: str | None = None
    target_type: str  # quests / ideas
    target_id: str
    target_title: str | None = None  # ideas のとき当該アイデア名（quests は None＝当該クエスト）


class QuestResultDTO(BaseModel):
    """クエスト最終結果（アイデア選別の申し送り・GET /quests/{id}/result）＝既存集計の合成＋総括。"""

    quest_id: str
    title: str
    status: str
    purpose: str | None = None
    deadline: date | None = None
    categories: list[str] = []
    decisions: list[QuestResultDecisionDTO] = []  # 公開アイデア（評価平均降順）。is_selected で①を抽出
    aspect_averages: QuestResultAspectAveragesDTO = QuestResultAspectAveragesDTO()
    participation: QuestResultParticipationDTO = QuestResultParticipationDTO()
    pinned_messages: list[QuestResultPinnedMessageDTO] = []  # ④議論の要点(b)＝ピン留めメッセージ
    outcome: QuestOutcomeDTO = QuestOutcomeDTO()
    outcome_revisions: list[QuestOutcomeRevisionDTO] = []  # 振り返りの変更履歴（折り畳みUI・§3.1）
    adopted_info: list[QuestResultAdoptedInfoDTO] = []  # ⑥採用された関連情報（FR-41 Phase2）
    can_edit: bool = False  # owner/quest_admin（④⑤の編集可否）


class QuestOutcomeRevisionDTO(BaseModel):
    """振り返り（総括）内容の版1行（SC-12 結果タブ 折り畳みUI・§3.1）。"""
    revision: int
    editor_name: str | None = None
    created_at: datetime
    changed_fields: list[str] = []
    memo: str | None = None


class QuestOutcomeDiffSegment(BaseModel):
    op: Literal["equal", "add", "del"]
    text: str


class QuestOutcomeDiffField(BaseModel):
    kind: Literal["text", "scalar"]
    segments: list[QuestOutcomeDiffSegment] | None = None
    old: str | None = None
    new: str | None = None


class QuestOutcomeRevisionDiffResponse(BaseModel):
    from_revision: int
    to_revision: int
    fields: dict[str, QuestOutcomeDiffField] = {}


# ---- クエスト定義の変更履歴＋ステータスログ（§3.1/§3.2・SC-12 リンクUI） ----

class QuestRevisionEditorDTO(BaseModel):
    user_id: str | None = None
    display_name: str | None = None
    avatar_image_url: str | None = None


class QuestRevisionDTO(BaseModel):
    revision: int
    editor: QuestRevisionEditorDTO
    created_at: datetime
    changed_fields: list[str] = []
    memo: str | None = None


class QuestRevisionCursorPageInfo(BaseModel):
    next_cursor: str | None = None
    has_next: bool = False


class QuestRevisionListResponse(BaseModel):
    data: list[QuestRevisionDTO] = []
    page_info: QuestRevisionCursorPageInfo = QuestRevisionCursorPageInfo()


class QuestRevisionDiffResponse(BaseModel):
    from_revision: int
    to_revision: int
    fields: dict[str, QuestOutcomeDiffField] = {}  # 差分フィールド形は共通（text=segments／scalar=old/new）


class QuestDecisionLogEntryDTO(BaseModel):
    kind: str  # status
    from_value: str | None = None
    to_value: str
    actor: QuestRevisionEditorDTO
    reason: str | None = None
    created_at: datetime


class QuestDecisionLogResponse(BaseModel):
    data: list[QuestDecisionLogEntryDTO] = []


class QuestOutcomeUpdateRequest(BaseModel):
    """PUT /quests/{id}/result（FR-39）＝総括の保存（owner/quest_admin）。送られた項目のみ更新。"""

    model_config = ConfigDict(extra="forbid")

    summary: str | None = None
    learnings: str | None = None
    next_actions: str | None = None
    metrics: list[QuestOutcomeMetricDTO] | None = None
