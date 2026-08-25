"""実績ルータ（`/api/v1`・テナントプレーン・ドメイン G）＝SC-40。読取専用（付与は台帳フックが一元化）。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.tenant.achievements import application as ach_service
from app.tenant.achievements.schemas import AchievementListResponse, MyAchievementsResponse

router = APIRouter(prefix="/api/v1", tags=["achievements"])


@router.get("/achievements", response_model=AchievementListResponse)
def list_achievements(
    request: Request,
    category: str | None = Query(default=None),
    state: str = Query(default="all"),
    session: dict = Depends(require_me),
) -> AchievementListResponse:
    """実績マスタ＋自分の獲得/進捗（SC-40・G.4）。シークレット未獲得は伏せる。読取専用。"""
    result = ach_service.get_achievements(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), category=category, state=state,
    )
    return AchievementListResponse(**result)


@router.get("/me/achievements", response_model=MyAchievementsResponse)
def get_my_achievements(request: Request, session: dict = Depends(require_me)) -> MyAchievementsResponse:
    """自分の獲得実績（獲得日・進捗・G.4）。読取専用。"""
    result = ach_service.get_my_achievements(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))
    return MyAchievementsResponse(**result)
