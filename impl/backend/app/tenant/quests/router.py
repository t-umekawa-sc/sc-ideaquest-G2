"""クエストルータ（`/api/v1`・テナントプレーン・ドメイン C）。

初のテナントルータ。認可は Depends(require_me)（P1/P2＝認証済み active 一般ユーザー・C はロールを問わず
パーティー/権限で門番するため）。会社/アカウントはセッション由来（§1.5・company_id はクエリで受けない）。
業務判断（可視性・カーソル）は application 層。本スライスは読み取り（SC-10）のみ。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.quests import application as quest_service
from app.tenant.quests.schemas import (
    QuestCandidatesResponse,
    QuestCreateRequest,
    QuestDetailDTO,
    QuestGroupsResponse,
    QuestIconImageResponse,
    QuestListResponse,
    QuestMemberAddRequest,
    QuestMemberDTO,
    QuestMemberPermissionsRequest,
    QuestMembersResponse,
    QuestPartyUpdateRequest,
    QuestPermissionsResponse,
    QuestPublishRequest,
    QuestTransitionRequest,
    QuestUpdateRequest,
)

router = APIRouter(prefix="/api/v1", tags=["quests"])


@router.get("/quests", response_model=QuestListResponse)
def list_quests(
    request: Request,
    q: str | None = None,
    status: list[str] | None = Query(default=None),
    group_id: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> QuestListResponse:
    """参加中クエスト＋自分の下書き一覧（SC-10・C.1・FR-15）。参照制限はサーバー強制。読取専用。"""
    result = quest_service.get_quests(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        q=q, status=status, group_id=group_id, limit=limit, cursor=cursor,
    )
    return QuestListResponse(**result)


@router.get("/quests/{quest_id}", response_model=QuestDetailDTO)
def get_quest(
    quest_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestDetailDTO:
    """クエスト詳細（SC-12 概要／SC-11 編集プリフィル・C.1）。可視性はサーバー強制（範囲外は 404）。読取専用。"""
    result = quest_service.get_quest_detail(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
    )
    return QuestDetailDTO(**result)


@router.get("/quest-groups", response_model=QuestGroupsResponse)
def list_quest_groups(
    request: Request,
    q: str | None = None,
    session: dict = Depends(require_me),
) -> QuestGroupsResponse:
    """自分が有効所属するクエストグループ一覧（SC-10 フィルタ・SC-11 グループ選択・C.4）。読取専用。"""
    result = quest_service.get_quest_groups(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), q=q,
    )
    return QuestGroupsResponse(**result)


@router.get("/quest-groups/{group_id}/members", response_model=QuestCandidatesResponse)
def list_group_member_candidates(
    request: Request,
    group_id: str,
    q: str | None = None,
    exclude_user_ids: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> QuestCandidatesResponse:
    """パーティー候補＝同一グループの有効メンバー（SC-11・C.4）。`exclude_user_ids` はサーバー側で除外。読取専用。"""
    result = quest_service.get_group_member_candidates(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), group_id,
        q=q, exclude_user_ids=exclude_user_ids, limit=limit, cursor=cursor,
    )
    return QuestCandidatesResponse(**result)


# ---- 変更系（SC-11・C.2/C.3）。認可＝require_me＋Origin/CSRF（§2.2/A.0）。業務ルールは application 強制 ----


@router.post("/quests", response_model=QuestDetailDTO, status_code=201)
def create_quest(
    body: QuestCreateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestDetailDTO:
    """クエストを作成（SC-11・C.2）。作成者＝所有者。status=recruiting は即公開（strict 検証＋参加通知）。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.create_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), body=body,
    )
    return QuestDetailDTO(**result)


@router.patch("/quests/{quest_id}", response_model=QuestDetailDTO)
def update_quest(
    quest_id: str,
    body: QuestUpdateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestDetailDTO:
    """クエストを編集（SC-11・C.2）。差分適用・検証は現在 status で分岐。owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.update_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, body=body,
    )
    return QuestDetailDTO(**result)


@router.post("/quests/{quest_id}/publish", response_model=QuestDetailDTO)
def publish_quest(
    quest_id: str,
    body: QuestPublishRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestDetailDTO:
    """下書きを公開（draft→recruiting・C.2・アトミック）。owner のみ・strict 検証・参加通知（H まで no-op）。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.publish_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, body=body,
    )
    return QuestDetailDTO(**result)


@router.put("/quests/{quest_id}/icon-image", response_model=QuestIconImageResponse)
async def put_quest_icon(
    quest_id: str,
    request: Request,
    file: UploadFile = File(...),
    session: dict = Depends(require_me),
) -> QuestIconImageResponse:
    """クエストアイコンを設定（SC-11・論点2・multipart・K.4 流儀）。owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    data = await file.read()
    result = quest_service.set_quest_icon(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
        data=data, content_type=file.content_type or "",
    )
    return QuestIconImageResponse(**result)


@router.delete("/quests/{quest_id}/icon-image", status_code=204)
def delete_quest_icon(
    quest_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """クエストアイコンを削除（既定表示に戻す・論点2）。owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    quest_service.delete_quest_icon(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
    )


# ---- パーティー粒度（SC-12 パーティータブ・C.3）／状態遷移（C.5）／削除 ----


@router.get("/quests/{quest_id}/members", response_model=QuestMembersResponse)
def list_quest_members(
    quest_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestMembersResponse:
    """パーティー＋権限（SC-12 パーティータブ・C.1）。可視性はサーバー強制（範囲外 404）。読取専用。"""
    result = quest_service.list_party_members(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
    )
    return QuestMembersResponse(**result)


@router.put("/quests/{quest_id}/party", response_model=QuestMembersResponse)
def set_quest_party(
    quest_id: str,
    body: QuestPartyUpdateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestMembersResponse:
    """パーティーを一括更新（C.3 PUT /party・あるべき全体像で差分適用）。owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.set_party(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, members=body.members,
    )
    return QuestMembersResponse(**result)


@router.post("/quests/{quest_id}/members", response_model=QuestMemberDTO, status_code=201)
def add_quest_member(
    quest_id: str,
    body: QuestMemberAddRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestMemberDTO:
    """メンバーを1名追加（C.3 POST /members・増分）。候補制限・owner 付与は作成者のみ・既定権限。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.add_party_member(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
        user_id=body.user_id, permissions=body.permissions,
    )
    return QuestMemberDTO(**result)


@router.delete("/quests/{quest_id}/members/{user_id}", status_code=204)
def remove_quest_member(
    quest_id: str,
    user_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """メンバーをパーティーから外す（C.3 DELETE /members・論理削除）。作成者は除外不可。owner/quest_admin。"""
    verify_origin(request)
    verify_csrf(request)
    quest_service.remove_party_member(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, user_id=user_id,
    )


@router.put("/quests/{quest_id}/members/{user_id}/permissions", response_model=QuestPermissionsResponse)
def set_quest_member_permissions(
    quest_id: str,
    user_id: str,
    body: QuestMemberPermissionsRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestPermissionsResponse:
    """あるメンバーの権限セットを置換（C.3 PUT .../permissions）。owner 付与は作成者のみ・作成者は保護。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.set_member_permissions(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
        user_id=user_id, permissions=body.permissions,
    )
    return QuestPermissionsResponse(**result)


@router.post("/quests/{quest_id}/transition", response_model=QuestDetailDTO)
def transition_quest(
    quest_id: str,
    body: QuestTransitionRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestDetailDTO:
    """ステータスを前進（C.5・owner/quest_admin）。逆行・飛び越えは 409。draft→recruiting は strict 検証。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.transition_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, to=body.to,
    )
    return QuestDetailDTO(**result)


@router.delete("/quests/{quest_id}", status_code=204)
def delete_quest(
    quest_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """クエストを論理削除（C.2 DELETE・owner/quest_admin）。子データは監査保持（§5.6）。"""
    verify_origin(request)
    verify_csrf(request)
    quest_service.delete_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
    )
