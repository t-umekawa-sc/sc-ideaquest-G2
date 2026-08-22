"""アイデアルータ（`/api/v1`・テナントプレーン・ドメイン D）。

認可＝Depends(require_me)（認証済み active 一般ユーザー）。門番（パーティー所属）・権限（idea_create・投稿者/
owner/quest_admin）・状態機械は application 層で強制。変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来（§1.5）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.ideas import application as idea_service
from app.tenant.ideas.schemas import (
    IdeaCreateRequest,
    IdeaDetailDTO,
    IdeaListResponse,
    IdeaPublishRequest,
    IdeaUpdateRequest,
)

router = APIRouter(prefix="/api/v1", tags=["ideas"])


@router.get("/quests/{quest_id}/ideas", response_model=IdeaListResponse)
def list_ideas(
    quest_id: str,
    request: Request,
    status: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> IdeaListResponse:
    """クエスト内アイデア一覧＋自分の下書き（SC-12・D.1）。門番はサーバー強制。読取専用。"""
    result = idea_service.get_ideas(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
        status=status, limit=limit, cursor=cursor,
    )
    return IdeaListResponse(**result)


@router.get("/ideas/{idea_id}", response_model=IdeaDetailDTO)
def get_idea(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaDetailDTO:
    """アイデア詳細（SC-22・D.1）。可視性はサーバー強制（範囲外 404）。読取専用。"""
    result = idea_service.get_idea_detail(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )
    return IdeaDetailDTO(**result)


@router.post("/quests/{quest_id}/ideas", response_model=IdeaDetailDTO, status_code=201)
def create_idea(
    quest_id: str,
    body: IdeaCreateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaDetailDTO:
    """アイデアを作成（SC-21・idea_create 権限）。status=published は作成＋即公開。"""
    verify_origin(request)
    verify_csrf(request)
    result = idea_service.create_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, body=body,
    )
    return IdeaDetailDTO(**result)


@router.patch("/ideas/{idea_id}", response_model=IdeaDetailDTO)
def update_idea(
    idea_id: str,
    body: IdeaUpdateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaDetailDTO:
    """アイデア編集（D.2）。現在 status で検証分岐・公開中は版記録。投稿者本人 or owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    result = idea_service.update_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, body=body,
    )
    return IdeaDetailDTO(**result)


@router.post("/ideas/{idea_id}/publish", response_model=IdeaDetailDTO)
def publish_idea(
    idea_id: str,
    body: IdeaPublishRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaDetailDTO:
    """下書きを公開（draft→published・D.2・アトミック）。draft 以外は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = idea_service.publish_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, body=body,
    )
    return IdeaDetailDTO(**result)


@router.delete("/ideas/{idea_id}", status_code=204)
def delete_idea(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """アイデアを論理削除（D.2）。投稿者本人 or owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    idea_service.delete_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )
