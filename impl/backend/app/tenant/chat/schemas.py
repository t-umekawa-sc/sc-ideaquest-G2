"""ドメイン E（チャット）の API DTO（Pydantic・§3.2・E.1〜E.5）。

投稿/編集は multipart（router で Form/File 受け）。読み取り応答はメッセージ表現（削除済みはトゥームストーン＝
多くのフィールドが欠落するため Optional）。reactions/reply_to は形が可変のため dict で保持（ideas.vote と同方針）。
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ChatAuthorDTO(BaseModel):
    id: str
    name: str
    avatar: str | None = None
    level: int | None = None


class ChatAttachmentDTO(BaseModel):
    id: str
    original_name: str
    size_bytes: int
    mime_type: str
    kind: str  # image / file


class ChatMentionDTO(BaseModel):
    user_id: str
    name: str


class ChatMessageDTO(BaseModel):
    """メッセージ表現（E.1）。削除済みは `is_deleted=true`＋`id/created_at/deleted_at` のみ。"""

    id: str
    is_deleted: bool = False
    is_mine: bool = False
    created_at: datetime
    deleted_at: datetime | None = None
    author: ChatAuthorDTO | None = None
    body: str | None = None
    is_edited: bool | None = None
    reply_to: dict | None = None  # {id, author_name, excerpt}
    attachments: list[ChatAttachmentDTO] = []
    mentions: list[ChatMentionDTO] = []
    reactions: dict | None = None  # {normal:[...], magic:{...}|null}


class ChatCursorPageInfo(BaseModel):
    next_cursor: str | None = None
    has_next: bool


class ChatUnreadDTO(BaseModel):
    first_unread_message_id: str | None = None
    unread_count: int = 0


class ChatListResponse(BaseModel):
    chat_group_id: str
    data: list[ChatMessageDTO]
    page_info: ChatCursorPageInfo
    unread: ChatUnreadDTO


class ChatActivityDaily(BaseModel):
    date: str
    message_count: int


class ChatActivityMarker(BaseModel):
    date: str
    revision: int


class ChatActivityResponse(BaseModel):
    daily: list[ChatActivityDaily] = []
    revision_markers: list[ChatActivityMarker] = []
    total_messages: int = 0


class ChatReactionRequest(BaseModel):
    type: str  # normal / magic
    emoji: str | None = None
    spell_id: str | None = None


class ChatReactionsResponse(BaseModel):
    reactions: dict  # {normal:[...], magic:{...}|null}


class ChatReadRequest(BaseModel):
    last_read_message_id: str


class ChatReadResponse(BaseModel):
    last_read_message_id: str
    unread_count: int = 0


class ChatDeleteResponse(BaseModel):
    id: str
    is_deleted: bool
    deleted_at: datetime | None = None
