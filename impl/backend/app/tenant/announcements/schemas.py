"""お知らせ（U・FR-49）の I/O スキーマ。body_text/published_at/created_by/監査はサーバー生成
（クライアントから受け取らない＝マスアサインメント防止・§2.2）。

本文リッチテキスト＝**PM-JSON（TipTap）を `body` で授受**（正本）。保存時に `sanitize_pm` で無害化し、
表示用 `body_html`（`pm_to_html`・サニタイズ済）を併せて返す。クライアントは編集に `body`、表示に
`body_html`（dangerouslySetInnerHTML）を使う。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


def _empty_doc() -> dict[str, Any]:
    return {"type": "doc", "content": []}


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
    body: dict[str, Any] = Field(default_factory=_empty_doc)  # PM-JSON 正本（エディタのプリフィル用）
    body_html: str                    # pm_to_html の派生（サニタイズ済）＝フロントは dangerouslySetInnerHTML で安全表示
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
    body: dict[str, Any] = Field(default_factory=_empty_doc)  # PM-JSON（保存時 sanitize_pm）
    status: str = "draft"             # draft|published（archived は PATCH で遷移）
    pinned: bool = False
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AnnouncementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body: dict[str, Any] | None = None  # PM-JSON（保存時 sanitize_pm）
    status: str | None = None         # draft|published|archived
    pinned: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AnnouncementImageUploadResponse(BaseModel):
    """本文貼付画像の再ホスト結果（POST /admin/announcements/images・U-8）＝自社ホスト（MinIO）署名URL。

    エディタの挿入/paste/ドロップハンドラが blob を送り、返った `url` で `img src` を置換する
    （外部参照・`data:` を持ち込まない。`sanitize_html` は http/https のみ許可＝`data:` は保存時に落ちる）。
    """
    url: str
