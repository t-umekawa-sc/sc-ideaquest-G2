"""ドメイン C（クエスト）の API DTO（Pydantic・§3.2 DB モデル直返し禁止）。

一覧（SC-10）＝カード配列＋カーソル page_info（§1.8）。内部列（deleted_* 等）は露出しない。
画像はキー直返し禁止＝短TTL 署名URL（`*_image_url`・§1.10）で返す（会社アバターと同方針）。
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel


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
