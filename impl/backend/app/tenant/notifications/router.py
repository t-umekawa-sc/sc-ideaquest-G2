"""通知ルータ（`/api/v1`・テナントプレーン・ドメイン H）＝SC-02＋ヘッダーベル。

認可＝Depends(require_me)。すべて自分宛スコープ（他人宛は 404・IDOR 対策・H.4）。変更系は Origin/CSRF（A.0）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.notifications import application as svc
from app.tenant.notifications.schemas import (
    NotificationListResponse,
    ReadAllRequest,
    ReadAllResponse,
    ReadResponse,
    UnreadCountResponse,
)

router = APIRouter(prefix="/api/v1", tags=["notifications"])


@router.get("/notifications", response_model=NotificationListResponse)
def list_notifications(
    request: Request,
    state: str = Query(default="all"),
    type: list[str] | None = Query(default=None),
    limit: int = Query(default=30),
    cursor: str | None = Query(default=None),
    session: dict = Depends(require_me),
) -> NotificationListResponse:
    """自分宛の通知一覧（SC-02・H.2）＋未読数。カーソル（§1.8・新着降順）。読取専用。"""
    result = svc.get_notifications(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        state=state, type_param=type, limit=limit, cursor=cursor,
    )
    return NotificationListResponse(**result)


@router.get("/notifications/unread-count", response_model=UnreadCountResponse)
def unread_count(request: Request, session: dict = Depends(require_me)) -> UnreadCountResponse:
    """未読数のみ（ヘッダーベル・軽量・H.2）。読取専用。"""
    result = svc.get_unread_count(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))
    return UnreadCountResponse(**result)


@router.post("/notifications/{notif_id}/read", response_model=ReadResponse)
def mark_read(notif_id: str, request: Request, session: dict = Depends(require_me)) -> ReadResponse:
    """個別に既読化（SC-02・参照先クリック時もサーバー既読化・H.3）。冪等。"""
    verify_origin(request)
    verify_csrf(request)
    result = svc.mark_read(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), notif_id)
    return ReadResponse(**result)


@router.post("/notifications/{notif_id}/unread", response_model=ReadResponse)
def mark_unread(notif_id: str, request: Request, session: dict = Depends(require_me)) -> ReadResponse:
    """個別に未読へ戻す（SC-02「未読に戻す」・H.3）。冪等。"""
    verify_origin(request)
    verify_csrf(request)
    result = svc.mark_unread(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), notif_id)
    return ReadResponse(**result)


@router.post("/notifications/read-all", response_model=ReadAllResponse)
def read_all(request: Request, body: ReadAllRequest | None = None, session: dict = Depends(require_me)) -> ReadAllResponse:
    """すべて既読化（type フィルタ適用可・H.3）。"""
    verify_origin(request)
    verify_csrf(request)
    result = svc.mark_all_read(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        type_param=(body.type if body else None),
    )
    return ReadAllResponse(**result)
