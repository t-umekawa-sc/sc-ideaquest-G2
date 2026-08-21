"""クエストルータ（`/api/v1`・テナントプレーン・ドメイン C）。

初のテナントルータ。認可は Depends(require_me)（P1/P2＝認証済み active 一般ユーザー・C はロールを問わず
パーティー/権限で門番するため）。会社/アカウントはセッション由来（§1.5・company_id はクエリで受けない）。
業務判断（可視性・カーソル）は application 層。本スライスは読み取り（SC-10）のみ。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.tenant.quests import application as quest_service
from app.tenant.quests.schemas import QuestGroupsResponse, QuestListResponse

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
