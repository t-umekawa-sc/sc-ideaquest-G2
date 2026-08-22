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
    quest_group: QuestGroupRefDTO
    # 自分の状態＝draft（本人の下書き）/ member（参加中）。未投稿/投稿済みはドメイン D 実装後に精緻化。
    my_state: str


class QuestListResponse(BaseModel):
    data: list[QuestCardDTO]
    page_info: QuestCursorPageInfo


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
    quest_group_id: str
    categories: list[str] = []
    deadline: date | None = None
    purpose: str | None = None
    icon_image_path: str | None = None
    members: list[QuestMemberInput] = []
    # 作成＝下書き or 即公開。状態機械の前進は publish/transition のみ（recruiting 以降は不可）。
    status: Literal["draft", "recruiting"] = "draft"


class QuestUpdateRequest(BaseModel):
    """PATCH /quests/{id}（C.2）。差分＝送られたフィールドのみ適用（`model_fields_set` で判定）。

    `quest_group_id` は不変・`status` は受け付けない（状態遷移は publish/transition）＝フィールド自体を持たない。
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    color: str | None = None
    categories: list[str] | None = None
    deadline: date | None = None
    purpose: str | None = None
    icon_image_path: str | None = None
    members: list[QuestMemberInput] | None = None


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
    quest_group: QuestGroupRefDTO
    my_state: str
    # 自分が持つ 6 権限（フロントの UX 出し分け・実アクションは各 EP で再検証・C.1）。
    my_permissions: list[str] = []
    members: list[QuestMemberDTO] = []
    created_at: datetime


class QuestIconImageResponse(BaseModel):
    """PUT/DELETE /quests/{id}/icon-image の応答＝設定後の短TTL 署名URL（削除時は None・K.4 流儀）。"""

    icon_image_url: str | None = None


class QuestCandidateDTO(BaseModel):
    """パーティー候補ユーザー1件（C.4 GET /quest-groups/{id}/members）。"""

    user_id: str
    display_name: str
    avatar_image_url: str | None = None


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
