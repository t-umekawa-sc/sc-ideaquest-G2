"""経営資料ルータ（`/api/v1`・テナントプレーン・ドメイン R・FR-44）。

CRUD は Depends(require_company_account_admin)＝会社アカウント管理者/system_admin（機微資料・R.0）。
選択用一覧（?for=selection）のみ require_me＝クエスト作成者が適用資料を選ぶ（軽量・active のみ）。
会社/アカウントはセッション由来（§1.5）。変更系は CSRF/Origin 検証（A.0）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.admin.deps import require_company_account_admin
from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.strategy import application as service
from app.tenant.strategy.schemas import (
    QuestLinkAddRequest,
    QuestLinkListResponse,
    StrategyDocCreateRequest,
    StrategyDocDetail,
    StrategyDocListResponse,
    StrategyDocSelectionResponse,
    StrategyDocUpdateRequest,
)

router = APIRouter(prefix="/api/v1", tags=["strategy"])


@router.get("/strategy-documents", response_model=StrategyDocListResponse | StrategyDocSelectionResponse)
def list_strategy_documents(
    request: Request,
    for_: str | None = Query(default=None, alias="for"),
    q: str | None = None,
    status: str | None = None,
    doc_kind: str | None = None,
    sort: str | None = None,
    page: int = 1,
    per_page: int = 20,
):
    # 選択用（?for=selection）＝クエスト作成者に開放（軽量・active のみ・R.0）。
    if for_ == "selection":
        session = require_me(request)
        return service.selection_list(
            uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), q=q)
    # 管理一覧＝会社アカウント管理者のみ（DataTable 契約）。
    session = require_company_account_admin(request)
    return service.list_documents(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        q=q, status=status, doc_kind=doc_kind, sort=sort, page=page, per_page=per_page)


# 紐づくクエストの候補検索（全社の有効クエスト・R.1b）。※/{doc_id} より前に定義（パス衝突回避）。
@router.get("/strategy-documents/quest-candidates", response_model=QuestLinkListResponse)
def strategy_quest_candidates(request: Request, q: str | None = None, status: str | None = None,
                              deadline_from: str | None = None, deadline_to: str | None = None,
                              session: dict = Depends(require_company_account_admin)):
    statuses = [s for s in (status or "").split(",") if s] or None
    return service.quest_candidates(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                                    q=q, statuses=statuses, deadline_from=deadline_from or None,
                                    deadline_to=deadline_to or None)


@router.get("/strategy-documents/{doc_id}", response_model=StrategyDocDetail)
def get_strategy_document(doc_id: str, request: Request, session: dict = Depends(require_company_account_admin)):
    return service.get_document(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), doc_id)


@router.post("/strategy-documents", response_model=StrategyDocDetail, status_code=201,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def create_strategy_document(body: StrategyDocCreateRequest, request: Request,
                             session: dict = Depends(require_company_account_admin)):
    return service.create_document(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), body=body)


@router.patch("/strategy-documents/{doc_id}", response_model=StrategyDocDetail,
              dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def update_strategy_document(doc_id: str, body: StrategyDocUpdateRequest, request: Request,
                             session: dict = Depends(require_company_account_admin)):
    return service.update_document(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), doc_id, body=body)


@router.post("/strategy-documents/{doc_id}/archive", response_model=StrategyDocDetail,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def archive_strategy_document(doc_id: str, request: Request,
                              session: dict = Depends(require_company_account_admin)):
    return service.archive_document(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), doc_id)


@router.post("/strategy-documents/{doc_id}/unarchive", response_model=StrategyDocDetail,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def unarchive_strategy_document(doc_id: str, request: Request,
                                session: dict = Depends(require_company_account_admin)):
    # アーカイブ解除（誤アーカイブの復元）。物理削除は設けない（基本は論理削除・R.1）。
    return service.unarchive_document(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), doc_id)


# ---- 紐づくクエスト（R.1b・§5.56・版履歴＝quest_revision） ----

@router.get("/strategy-documents/{doc_id}/quests", response_model=QuestLinkListResponse)
def list_strategy_quests(doc_id: str, request: Request, session: dict = Depends(require_company_account_admin)):
    return service.linked_quests(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), doc_id)


@router.post("/strategy-documents/{doc_id}/quests", response_model=QuestLinkListResponse,
             dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def add_strategy_quests(doc_id: str, body: QuestLinkAddRequest, request: Request,
                        session: dict = Depends(require_company_account_admin)):
    return service.add_quest_links(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
                                   doc_id, quest_ids=body.quest_ids)


@router.delete("/strategy-documents/{doc_id}/quests/{quest_id}", response_model=QuestLinkListResponse,
               dependencies=[Depends(verify_origin), Depends(verify_csrf)])
def remove_strategy_quest(doc_id: str, quest_id: str, request: Request,
                          session: dict = Depends(require_company_account_admin)):
    return service.remove_quest_link(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), doc_id, quest_id)
