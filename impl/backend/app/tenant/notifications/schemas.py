"""ドメイン H（通知）の API DTO（§3.2・H.2/H.3）。body は取得時レンダリング済み（§8-⑳）。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NotifRef(BaseModel):
    """種別に応じた遷移先（フロントが href を解決・H.2）。"""
    idea_id: str | None = None
    chat_message_id: str | None = None
    idea_revision_id: str | None = None
    achievement_id: str | None = None
    quest_id: str | None = None


class NotifMeta(BaseModel):
    """獲得表示用（本人が獲得した値のみ＝achievement のコイン・H.2）。"""
    coin: int | None = None


class NotificationDTO(BaseModel):
    id: str
    type: str
    body: str  # 取得時レンダリング済み（§8-⑳）
    context: str | None = None  # 副題（クエスト/アイデア等）
    icon: str | None = None
    tag: str | None = None  # 「投票の見直し」/「セキュリティ」
    ref: NotifRef = NotifRef()
    is_read: bool = False
    created_at: datetime
    meta: NotifMeta | None = None


class CursorPageInfo(BaseModel):
    next_cursor: str | None = None
    has_next: bool = False


class NotificationListResponse(BaseModel):
    data: list[NotificationDTO]
    page_info: CursorPageInfo
    unread_count: int


class UnreadCountResponse(BaseModel):
    unread_count: int


class ReadResponse(BaseModel):
    id: str
    is_read: bool
    unread_count: int


class ReadAllRequest(BaseModel):
    type: str | None = None


class ReadAllResponse(BaseModel):
    updated: int
    unread_count: int
