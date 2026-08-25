"""アイデアルータ（`/api/v1`・テナントプレーン・ドメイン D）。

認可＝Depends(require_me)（認証済み active 一般ユーザー）。門番（パーティー所属）・権限（idea_create・投稿者/
owner/quest_admin）・状態機械は application 層で強制。変更系は Origin/CSRF（A.0）。会社/アカウントはセッション由来（§1.5）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.ideas import application as idea_service
from app.tenant.ideas.schemas import (
    IdeaAttachmentDownloadResponse,
    IdeaAttachmentsResponse,
    IdeaCreateRequest,
    IdeaDetailDTO,
    IdeaListResponse,
    IdeaPublishRequest,
    IdeaRevisionDiffResponse,
    IdeaRevisionListResponse,
    IdeaUpdateRequest,
    IdeaVoteRequest,
    IdeaVoteResponse,
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


@router.get("/ideas/{idea_id}/revisions", response_model=IdeaRevisionListResponse)
def list_revisions(
    idea_id: str,
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> IdeaRevisionListResponse:
    """版タイムライン（SC-22 更新履歴・D.4）。可視性はサーバー強制（範囲外 404）。読取専用。"""
    result = idea_service.get_revisions(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
        limit=limit, cursor=cursor,
    )
    return IdeaRevisionListResponse(**result)


@router.get("/ideas/{idea_id}/revisions/{revision}/diff", response_model=IdeaRevisionDiffResponse)
def revision_diff(
    idea_id: str,
    revision: int,
    request: Request,
    from_: int | None = Query(default=None, alias="from"),
    session: dict = Depends(require_me),
) -> IdeaRevisionDiffResponse:
    """版差分（SC-22・D.4）。既定は前版比較・`from` で比較元を指定（投票時点差分）。範囲外 404/422。読取専用。"""
    result = idea_service.get_revision_diff(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, revision,
        from_revision=from_,
    )
    return IdeaRevisionDiffResponse(**result)


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


@router.post("/ideas/{idea_id}/vote", response_model=IdeaVoteResponse)
def vote_idea(
    idea_id: str,
    body: IdeaVoteRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> IdeaVoteResponse:
    """投票を登録/切替（SC-22・D.5・vote 権限・公開＋未凍結）。1人1票 upsert・締切後/completed は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = idea_service.vote_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, vote_type=body.type,
    )
    return IdeaVoteResponse(**result)


@router.delete("/ideas/{idea_id}/vote", status_code=204)
def remove_vote(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """投票を取消（D.5・冪等・XP は戻さない）。completed は 409。"""
    verify_origin(request)
    verify_csrf(request)
    idea_service.remove_vote(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )


@router.post("/ideas/{idea_id}/follow", status_code=204)
def follow_idea(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """アイデアをフォロー（D.6・冪等・パーティー所属）。completed 後の新規は 409。"""
    verify_origin(request)
    verify_csrf(request)
    idea_service.follow_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )


@router.delete("/ideas/{idea_id}/follow", status_code=204)
def unfollow_idea(
    idea_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """フォロー解除（D.6・冪等・completed 後も可）。"""
    verify_origin(request)
    verify_csrf(request)
    idea_service.unfollow_idea(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id,
    )


@router.post("/ideas/{idea_id}/attachments", response_model=IdeaAttachmentsResponse, status_code=201)
async def add_attachments(
    idea_id: str,
    request: Request,
    files: list[UploadFile] = File(...),
    session: dict = Depends(require_me),
) -> IdeaAttachmentsResponse:
    """アイデアに添付を追加（D.3・multipart・編集権限・完了は 409）。検証はサーバー強制（§1.10）。"""
    verify_origin(request)
    verify_csrf(request)
    payloads = [((f.filename or ""), await f.read()) for f in files]
    result = idea_service.add_attachments(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, files=payloads,
    )
    return IdeaAttachmentsResponse(**result)


@router.delete("/ideas/{idea_id}/attachments/{attachment_id}", status_code=204)
def remove_attachment(
    idea_id: str,
    attachment_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """添付を削除（D.3・編集権限・完了は 409）。DB 行＋MinIO オブジェクト削除。"""
    verify_origin(request)
    verify_csrf(request)
    idea_service.remove_attachment(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), idea_id, attachment_id,
    )


@router.get("/attachments/{attachment_id}/download", response_model=IdeaAttachmentDownloadResponse)
def download_attachment(
    attachment_id: str,
    session: dict = Depends(require_me),
) -> IdeaAttachmentDownloadResponse:
    """添付ダウンロード（D.3・§1.10）＝パーティー所属を検証し短TTL 署名URL を返す。読取専用。"""
    result = idea_service.download_attachment(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), attachment_id,
    )
    return IdeaAttachmentDownloadResponse(**result)
