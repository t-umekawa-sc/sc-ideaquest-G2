"""お知らせ（U・FR-49）の I/O スキーマ。body_text/published_at/created_by/監査はサーバー生成
（クライアントから受け取らない＝マスアサインメント防止・§2.2）。body_html は保存時サニタイズ。"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AnnouncementListItem(BaseModel):
    id: str
    title: str
    excerpt: str                      # body_text の先頭抜粋（カード表示用・一覧の列からは除外）
    pinned: bool = False
    published_at: datetime | None = None
    is_read: bool = False
    read_at: datetime | None = None    # 閲覧者の既読日時（未読は null・SC-95 一覧列）


class PageInfo(BaseModel):
    next_cursor: str | None = None
    has_next: bool = False


class AnnouncementListResponse(BaseModel):
    data: list[AnnouncementListItem] = []
    page_info: PageInfo = PageInfo()
    unread_count: int = 0


class AnnouncementAuthor(BaseModel):
    display_name: str | None = None


class AnnouncementDetail(BaseModel):
    id: str
    title: str
    body_html: str                    # サニタイズ済（nh3）＝フロントは dangerouslySetInnerHTML で安全表示
    pinned: bool = False
    published_at: datetime | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    created_by: AnnouncementAuthor = AnnouncementAuthor()
    is_read: bool = False


class ReadResponse(BaseModel):
    is_read: bool = True


# ---- 管理（U.2） ----

class AdminAnnouncementItem(BaseModel):
    id: str
    title: str
    status: str
    pinned: bool = False
    published_at: datetime | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    read_count: int = 0


class AdminAnnouncementListResponse(BaseModel):
    data: list[AdminAnnouncementItem] = []
    can_manage: bool = False


class AnnouncementCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body_html: str = ""
    status: str = "draft"             # draft|published（archived は PATCH で遷移）
    pinned: bool = False
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AnnouncementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body_html: str | None = None
    status: str | None = None         # draft|published|archived
    pinned: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
