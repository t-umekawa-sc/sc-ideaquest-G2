"""お知らせルータ（`/api/v1/announcements`・テナントプレーン・ドメイン U・FR-49）。

閲覧（一覧/詳細/既読化）＝全ユーザー（require_me・公開会社の general も可＝外周許可リスト）。
投稿/編集/削除＝管理者のみ（application 層で 403・二重防御）。変更系は CSRF/Origin（A.0）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Request, UploadFile

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.announcements import application as service
from app.tenant.announcements.schemas import (
    AdminAnnouncementListResponse,
    AnnouncementCreateRequest,
    AnnouncementDetail,
    AnnouncementImageUploadResponse,
    AnnouncementListResponse,
    AnnouncementUpdateRequest,
    ReadResponse,
)

router = APIRouter(prefix="/api/v1", tags=["announcements"])


# ---- 閲覧（全ユーザー・U.1） ----

@router.get("/announcements", response_model=AnnouncementListResponse)
def list_announcements(request: Request, cursor: str | None = None, limit: int = 20,
                       unread: bool = False, session: dict = Depends(require_me)):
    return service.list_announcements(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        cursor=cursor, limit=min(max(limit, 1), 50), only_unread=unread)


@router.get("/announcements/{announcement_id}", response_model=AnnouncementDetail)
def get_announcement(announcement_id: str, request: Request, session: dict = Depends(require_me)):
    return service.get_announcement(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), announcement_id)


@router.post("/announcements/{announcement_id}/read", response_model=ReadResponse,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def read_announcement(announcement_id: str, request: Request, session: dict = Depends(require_me)):
    return service.read_announcement(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), announcement_id)


# ---- 管理（管理者のみ・U.2） ----

@router.get("/admin/announcements", response_model=AdminAnnouncementListResponse)
def list_admin_announcements(request: Request, session: dict = Depends(require_me)):
    return service.list_admin(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))


@router.post("/admin/announcements", response_model=dict, status_code=201,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def create_announcement(body: AnnouncementCreateRequest, request: Request, session: dict = Depends(require_me)):
    return service.create_announcement(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        title=body.title, body_html=body.body_html, status=body.status, pinned=body.pinned,
        starts_at=body.starts_at, ends_at=body.ends_at)


@router.post("/admin/announcements/images", response_model=AnnouncementImageUploadResponse, status_code=201,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
async def rehost_announcement_image(
    request: Request,
    file: UploadFile = File(...),
    session: dict = Depends(require_me),
) -> AnnouncementImageUploadResponse:
    """本文貼付画像の再ホスト（U-8・§1.10）＝multipart・管理者のみ。自社ホスト署名URL を返す。

    静的パス（`/admin/announcements/images`）＝動的 `/admin/announcements/{id}` より前に定義（優先ルーティング）。
    """
    data = await file.read()
    result = service.rehost_image(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        data=data, content_type=file.content_type or "",
    )
    return AnnouncementImageUploadResponse(**result)


@router.patch("/admin/announcements/{announcement_id}", response_model=dict,
              dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def update_announcement(announcement_id: str, body: AnnouncementUpdateRequest, request: Request,
                        session: dict = Depends(require_me)):
    return service.update_announcement(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), announcement_id,
        body.model_dump(exclude_unset=True))


@router.delete("/admin/announcements/{announcement_id}", status_code=204,
               dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def delete_announcement(announcement_id: str, request: Request, session: dict = Depends(require_me)):
    service.delete_announcement(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), announcement_id)
