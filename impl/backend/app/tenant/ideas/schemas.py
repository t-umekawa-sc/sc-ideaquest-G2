"""ドメイン D（アイデア）の API DTO（Pydantic・§3.2 DB モデル直返し禁止・D.1/D.2）。

request は extra=forbid（Mass Assignment 防止・§2.2/D.2）。応答は一覧カード（SC-12 アイデアタブ）と
詳細（SC-22）。画像はキー直返し禁止＝短TTL 署名URL（`*_image_url`）。名前は D 専用の一意名（Idea*）で
OpenAPI schema 名の衝突を避ける。
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

# アイデア内 6 権限のうち作成に要る権限（permission_type・§3）。値検証はサーバー（application）。
STATUS_VALUES: frozenset[str] = frozenset({"draft", "published"})


class IdeaCursorPageInfo(BaseModel):
    """カーソルページングの共通エンベロープ（§1.8・D 専用の一意名）。"""

    next_cursor: str | None = None
    has_next: bool


class IdeaAuthorDTO(BaseModel):
    user_id: str
    display_name: str
    avatar_image_url: str | None = None
    level: int | None = None


class IdeaQuestRefDTO(BaseModel):
    """アイデアが属するクエストの参照（SC-22 の「クエストへ戻る」導線・カテゴリーバッジ・凍結判定・D.1）。"""

    id: str
    title: str
    status: str
    categories: list[str] = []
    deadline: date | None = None


class IdeaVoteSummaryDTO(BaseModel):
    approve: int = 0
    oppose: int = 0


class IdeaStakeholderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    is_custom: bool | None = None


class IdeaStakeholderDTO(BaseModel):
    label: str
    is_custom: bool


# ---- request（作成/編集/公開・D.2） ----


class IdeaCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    value: str
    body: str
    time_limit: date | None = None
    stakeholders: list[IdeaStakeholderInput] = []
    note: str | None = None
    # 作成＝下書き or 即公開。状態機械の前進は publish 専任（published→以降は変えない）。
    status: Literal["draft", "published"] = "draft"


class IdeaUpdateRequest(BaseModel):
    """PATCH /ideas/{id}（D.2）。差分＝送られたフィールドのみ。status は受け付けない（遷移は publish）。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    value: str | None = None
    body: str | None = None
    time_limit: date | None = None
    stakeholders: list[IdeaStakeholderInput] | None = None
    note: str | None = None


class IdeaPublishRequest(BaseModel):
    """POST /ideas/{id}/publish（D.2）。内容フィールドは省略可（未送信は現在値）。"""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    value: str | None = None
    body: str | None = None
    time_limit: date | None = None
    stakeholders: list[IdeaStakeholderInput] | None = None
    note: str | None = None


class IdeaVoteRequest(BaseModel):
    """POST /ideas/{id}/vote（D.5）。賛成/反対の登録・切替。"""

    model_config = ConfigDict(extra="forbid")

    type: Literal["approve", "oppose"]


class IdeaVoteResponse(BaseModel):
    """投票結果（D.5）。my_vote＝自分の投票／summary＝賛成/反対数／xp_awarded＝初回付与か（G 実装まで False）。"""

    my_vote: str | None = None
    summary: IdeaVoteSummaryDTO
    xp_awarded: bool = False


# ---- response（一覧カード/詳細） ----


class IdeaCardDTO(BaseModel):
    """一覧の1件（SC-12 アイデアタブ・D.1）。"""

    id: str
    title: str
    status: str
    author: IdeaAuthorDTO
    vote_summary: IdeaVoteSummaryDTO
    comment_count: int  # ドメイン E 未実装＝0
    is_selected: bool
    current_revision: int
    updated_at: datetime
    my_vote: str | None = None
    following: bool = False
    # 自分の状態＝draft（本人の下書き）/ member（参加中・未投稿/投稿済みは D 完了後に精緻化）。
    my_state: str


class IdeaListResponse(BaseModel):
    data: list[IdeaCardDTO]
    page_info: IdeaCursorPageInfo


class IdeaDetailDTO(BaseModel):
    """アイデア詳細（SC-22・D.1）。評価(F)/チャット(E)/添付(D.3)は各ドメインで合成/後続。"""

    id: str
    title: str
    value: str
    body: str
    stakeholders: list[IdeaStakeholderDTO] = []
    time_limit: date | None = None
    note: str | None = None
    status: str
    is_selected: bool
    current_revision: int
    author: IdeaAuthorDTO
    quest: IdeaQuestRefDTO
    created_at: datetime
    updated_at: datetime
    vote: dict  # {summary:{approve,oppose}, my_vote}
    following: bool = False
    my_permissions: list[str] = []
    my_state: str
