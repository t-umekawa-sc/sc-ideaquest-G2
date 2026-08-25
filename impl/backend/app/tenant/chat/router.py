"""チャットルータ（`/api/v1`・テナントプレーン・ドメイン E）。

認可＝Depends(require_me)。門番（パーティー所属）・権限（comment／本人／管理者）・状態機械は application 層で強制。
投稿/編集は multipart。変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来（§1.5）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.chat import application as chat_service
from app.tenant.chat.schemas import (
    ChatActivityResponse,
    ChatDeleteResponse,
    ChatListResponse,
    ChatMessageDTO,
    ChatReadRequest,
    ChatReadResponse,
)

router = APIRouter(prefix="/api/v1", tags=["chat"])


@router.get("/ideas/{idea_id}/chat", response_model=ChatListResponse)
def get_chat(
    idea_id: str,
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    before: str | None = None,
    after: str | None = None,
    session: dict = Depends(require_me),
) -> ChatListResponse:
    """チャットメッセージ一覧＋未読情報（SC-24・E.1）。門番はサーバー強制。読取専用。"""
    result = chat_service.get_chat(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
        limit=limit, before=before, after=after,
    )
    return ChatListResponse(**result)


@router.get("/ideas/{idea_id}/chat-activity", response_model=ChatActivityResponse)
def get_chat_activity(
    idea_id: str,
    request: Request,
    days: int = Query(default=14, ge=1, le=90),
    session: dict = Depends(require_me),
) -> ChatActivityResponse:
    """議論アクティビティ集計（SC-22 §4.4・D から委譲・E.1）。読取専用。"""
    result = chat_service.get_chat_activity(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, days=days,
    )
    return ChatActivityResponse(**result)


@router.post("/chat-messages", response_model=ChatMessageDTO, status_code=201)
async def post_message(
    request: Request,
    idea_id: str = Form(...),
    body: str | None = Form(default=None),
    reply_to_message_id: str | None = Form(default=None),
    mentions: list[str] | None = Form(default=None),
    files: list[UploadFile] | None = File(default=None),
    session: dict = Depends(require_me),
) -> ChatMessageDTO:
    """メッセージ投稿（SC-24・E.2・multipart）。空は 422・投稿 XP+5（日次上限）。完了は 409。"""
    verify_origin(request)
    verify_csrf(request)
    payloads = [((f.filename or ""), await f.read()) for f in (files or [])]
    result = chat_service.post_message(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        idea_id=idea_id, body=body, reply_to_message_id=reply_to_message_id,
        mention_ids=mentions, files=payloads,
    )
    return ChatMessageDTO(**result)


@router.patch("/chat-messages/{message_id}", response_model=ChatMessageDTO)
async def edit_message(
    message_id: str,
    request: Request,
    body: str | None = Form(default=None),
    mentions: list[str] | None = Form(default=None),
    files: list[UploadFile] | None = File(default=None),
    remove_attachment_ids: list[str] | None = Form(default=None),
    session: dict = Depends(require_me),
) -> ChatMessageDTO:
    """自分のメッセージを編集（E.2・本人のみ）。本文/添付/メンションを更新。完了は 409。"""
    verify_origin(request)
    verify_csrf(request)
    payloads = [((f.filename or ""), await f.read()) for f in (files or [])]
    result = chat_service.edit_message(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), message_id,
        body=body, mention_ids=mentions, files=payloads, remove_attachment_ids=remove_attachment_ids,
    )
    return ChatMessageDTO(**result)


@router.delete("/chat-messages/{message_id}", response_model=ChatDeleteResponse)
def delete_message(
    message_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> ChatDeleteResponse:
    """メッセージを論理削除（E.2・本人＋owner/quest_admin）。完了は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = chat_service.delete_message(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), message_id,
    )
    return ChatDeleteResponse(**result)


@router.post("/ideas/{idea_id}/chat/read", response_model=ChatReadResponse)
def mark_read(
    idea_id: str,
    body: ChatReadRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> ChatReadResponse:
    """既読位置を更新（E.5・後退防止 upsert）。完了後も許可。"""
    verify_origin(request)
    verify_csrf(request)
    result = chat_service.mark_read(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
        last_read_message_id=body.last_read_message_id,
    )
    return ChatReadResponse(**result)
