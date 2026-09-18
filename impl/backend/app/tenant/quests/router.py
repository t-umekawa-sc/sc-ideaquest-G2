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
    FollowResponse,
    JoinRequestBody,
    JoinRequestDecisionResponse,
    JoinRequestListResponse,
    JoinRequestProfileDTO,
    JoinRequestResponse,
    QuestActivityDTO,
    QuestCandidatesResponse,
    QuestCatalogCardDTO,
    QuestCatalogDetailDTO,
    QuestCatalogResponse,
    QuestCreateRequest,
    QuestDetailDTO,
    QuestGroupsResponse,
    QuestIconImageResponse,
    QuestListResponse,
    QuestMemberAddRequest,
    QuestMemberDTO,
    QuestMemberPermissionsRequest,
    QuestMembersResponse,
    QuestOutcomeDTO,
    QuestOutcomeUpdateRequest,
    QuestPartyUpdateRequest,
    QuestPermissionsResponse,
    QuestResultDTO,
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
    sort: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> QuestListResponse:
    """参加中クエスト＋自分の下書き一覧（SC-10・C.1・FR-15）。参照制限はサーバー強制。読取専用。"""
    result = quest_service.get_quests(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        q=q, status=status, group_id=group_id, sort=sort, limit=limit, cursor=cursor,
    )
    return QuestListResponse(**result)


# ---- 発見カタログ・フォロー・参加リクエスト（FR-40・C.9・SC-13） ----

@router.get("/quest-catalog", response_model=QuestCatalogResponse)
def quest_catalog(
    request: Request,
    q: str | None = None,
    category: str | None = None,   # enum 多値（カンマ）＝UGC ラベル（ホワイトリスト検証なし）
    group_id: str | None = None,
    sort: str | None = None,       # -created_at〔既定〕/deadline/-member_count（未知は 422）
    page: int | None = Query(default=None, ge=1),
    per_page: int | None = Query(default=None, ge=1, le=100),
    session: dict = Depends(require_me),
) -> QuestCatalogResponse:
    """発見カタログ＝発見可能クエストのメタ一覧＋自分の my_state（SC-13・C.9.1）。中身は返さない。読取専用。"""
    result = quest_service.get_quest_catalog(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        q=q, category=category, group_id=group_id, sort=sort, page=page, per_page=per_page,
    )
    return QuestCatalogResponse(**result)


@router.get("/quests/{quest_id}/catalog-detail", response_model=QuestCatalogDetailDTO)
def quest_catalog_detail(quest_id: str, request: Request, session: dict = Depends(require_me)) -> QuestCatalogDetailDTO:
    """掲示板ダイアログ用のメタ詳細（SC-13・C.9.1）＝カード＋活発度スパーク。発見門番のみ・中身は返さない。読取専用。"""
    result = quest_service.get_catalog_detail(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)
    return QuestCatalogDetailDTO(**result)


@router.post("/quests/{quest_id}/follow", response_model=FollowResponse)
def follow_quest(quest_id: str, request: Request, session: dict = Depends(require_me)) -> FollowResponse:
    """クエストをフォロー（watch・C.9）。発見可能なクエストのみ。変更系＝Origin/CSRF。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.follow_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)
    return FollowResponse(**result)


@router.delete("/quests/{quest_id}/follow", response_model=FollowResponse)
def unfollow_quest(quest_id: str, request: Request, session: dict = Depends(require_me)) -> FollowResponse:
    """フォロー解除（C.9・冪等）。変更系＝Origin/CSRF。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.unfollow_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)
    return FollowResponse(**result)


@router.post("/quests/{quest_id}/join-request", response_model=JoinRequestResponse, status_code=201)
def create_join_request(
    quest_id: str, body: JoinRequestBody, request: Request, session: dict = Depends(require_me),
) -> JoinRequestResponse:
    """参加をリクエスト（C.9・pending 作成→作成者/quest_admin へ通知）。変更系＝Origin/CSRF。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.request_join(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, message=body.message)
    return JoinRequestResponse(**result)


@router.delete("/quests/{quest_id}/join-request", status_code=204)
def withdraw_join_request(quest_id: str, request: Request, session: dict = Depends(require_me)) -> None:
    """自分の申請を取り下げ（pending→withdrawn・C.9）。変更系＝Origin/CSRF。"""
    verify_origin(request)
    verify_csrf(request)
    quest_service.withdraw_join_request(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)


@router.get("/quests/{quest_id}/join-requests", response_model=JoinRequestListResponse)
def list_join_requests(
    quest_id: str,
    request: Request,
    status: list[str] | None = Query(default=None),
    session: dict = Depends(require_me),
) -> JoinRequestListResponse:
    """参加リクエスト一覧（受信側・SC-12 パーティータブ・C.9.1）＝owner/quest_admin のみ。読取専用。"""
    result = quest_service.list_join_requests(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, statuses=status)
    return JoinRequestListResponse(**result)


@router.post("/quests/{quest_id}/join-requests/{user_id}/approve", response_model=JoinRequestDecisionResponse)
def approve_join_request(
    quest_id: str, user_id: str, request: Request, session: dict = Depends(require_me),
) -> JoinRequestDecisionResponse:
    """参加リクエストを承認＝member 追加（C.9.1・owner/quest_admin）。変更系＝Origin/CSRF（冪等は Idempotency-Key）。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.approve_join_request(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, user_id)
    return JoinRequestDecisionResponse(**result)


@router.post("/quests/{quest_id}/join-requests/{user_id}/reject", response_model=JoinRequestDecisionResponse)
def reject_join_request(
    quest_id: str, user_id: str, request: Request, session: dict = Depends(require_me),
) -> JoinRequestDecisionResponse:
    """参加リクエストを却下（非終端・C.9.1・owner/quest_admin）。変更系＝Origin/CSRF。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.reject_join_request(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, user_id)
    return JoinRequestDecisionResponse(**result)


@router.get("/quests/{quest_id}/activity", response_model=QuestActivityDTO)
def get_quest_activity(quest_id: str, request: Request, session: dict = Depends(require_me)) -> QuestActivityDTO:
    """クエスト内の活発度スパーク（SC-12・C.1）＝メンバー可視・日次メッセージ数。読取専用。"""
    result = quest_service.get_quest_activity(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id)
    return QuestActivityDTO(**result)


@router.get("/quests/{quest_id}/join-requests/{user_id}/profile", response_model=JoinRequestProfileDTO)
def get_join_request_profile(
    quest_id: str, user_id: str, request: Request, session: dict = Depends(require_me),
) -> JoinRequestProfileDTO:
    """申請者プロフィール（承認判断材料・C.9.1・owner/quest_admin のみ）。ゲーム層は viewer のゲームモード ON 時のみ。読取専用。"""
    result = quest_service.get_join_request_profile(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, user_id)
    return JoinRequestProfileDTO(**result)


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


@router.get("/quest-group-directory", response_model=QuestGroupsResponse)
def list_company_group_directory(
    request: Request,
    q: str | None = None,
    session: dict = Depends(require_me),
) -> QuestGroupsResponse:
    """会社内の全クエストグループ（部署ディレクトリ・SC-11 追加グループ選択・FR-38・C.4）。所属に依らず全件。読取専用。"""
    result = quest_service.get_company_group_directory(
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


@router.get("/quest-group-candidates", response_model=QuestCandidatesResponse)
def list_quest_group_candidates(
    request: Request,
    group_ids: list[str] = Query(default=None),
    q: str | None = None,
    exclude_user_ids: list[str] | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> QuestCandidatesResponse:
    """複数グループ横断のパーティー候補（FR-38・SC-11/SC-12・C.4）。候補ごとに所属 group_id 配列を返す。

    門番＝リクエスト者がいずれかの指定グループに有効所属（非所属は 404）。`exclude_user_ids` はサーバー側除外。読取専用。
    """
    result = quest_service.get_quest_group_candidates(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        group_ids=group_ids or [], q=q, exclude_user_ids=exclude_user_ids, limit=limit, cursor=cursor,
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


@router.get("/quests/{quest_id}/result", response_model=QuestResultDTO)
def get_quest_result(
    quest_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestResultDTO:
    """クエスト最終結果＝アイデア選別の申し送り（FR-39・SC-12 結果タブ）。可視性はサーバー強制（範囲外 404）。読取専用。"""
    result = quest_service.get_quest_result(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
    )
    return QuestResultDTO(**result)


@router.post("/quests/{quest_id}/result/chat-summary", response_model=QuestOutcomeDTO)
def post_quest_chat_summary(
    quest_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestOutcomeDTO:
    """議論の要点(c)＝チャットの自動要約（抽出型・オフライン・無料）を生成/再生成（FR-39・owner/quest_admin）。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.generate_chat_summary(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
    )
    return QuestOutcomeDTO(**result)


@router.put("/quests/{quest_id}/result", response_model=QuestOutcomeDTO)
def put_quest_result(
    quest_id: str,
    body: QuestOutcomeUpdateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> QuestOutcomeDTO:
    """総括（振り返り・次アクション・KPI）の保存（FR-39・owner/quest_admin）。送られた項目のみ更新。"""
    verify_origin(request)
    verify_csrf(request)
    result = quest_service.update_quest_outcome(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id, body=body,
    )
    return QuestOutcomeDTO(**result)


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
