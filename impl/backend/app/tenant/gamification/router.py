"""ゲーミフィケーション ルータ（`/api/v1`・テナントプレーン・ドメイン G）＝魔法カタログ/解放（SC-32・E.4 前提）。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.gamification import application as gami_service
from app.tenant.gamification.schemas import (
    QuestFeedResponse,
    RankingResponse,
    SpellCatalogResponse,
    SpellUnlockResponse,
    TeamFeedResponse,
)

router = APIRouter(prefix="/api/v1", tags=["gamification"])


@router.get("/rankings", response_model=RankingResponse)
def get_rankings(
    request: Request,
    period: str = Query(default="this_week"),
    scope: str = Query(default="company"),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> RankingResponse:
    """期間スコア（獲得XP＋獲得コイン）ランキング（SC-41 全社／SC-12 クエスト内・G.5）。me 常時同梱。読取専用。"""
    result = gami_service.get_rankings(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        period=period, scope=scope, limit=limit, cursor=cursor,
    )
    return RankingResponse(**result)


@router.get("/quests/{quest_id}/activities", response_model=QuestFeedResponse)
def get_quest_activities(
    quest_id: str, request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> QuestFeedResponse:
    """クエスト内アクティビティフィード（SC-12・G.5.1）＝メンバー活動の公開種別のみ・新しい順。門番＝パーティー所属（範囲外 404）。読取専用。"""
    result = gami_service.get_quest_activities(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
        limit=limit, cursor=cursor,
    )
    return QuestFeedResponse(**result)


@router.get("/me/feed", response_model=TeamFeedResponse)
def get_team_feed(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    session: dict = Depends(require_me),
) -> TeamFeedResponse:
    """チームフィード（SC-01・G.5.1）＝自分の参加クエスト横断のメンバー活動（公開種別のみ・各行に quest 付き）。読取専用。"""
    result = gami_service.get_team_feed(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        limit=limit, cursor=cursor,
    )
    return TeamFeedResponse(**result)


@router.get("/spells", response_model=SpellCatalogResponse)
def list_spells(request: Request, session: dict = Depends(require_me)) -> SpellCatalogResponse:
    """魔法カタログ＋解放状態（SC-32・E.4 ピッカー）。読取専用。"""
    result = gami_service.list_spells(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]))
    return SpellCatalogResponse(**result)


@router.post("/spells/{spell_id}/unlock", response_model=SpellUnlockResponse)
def unlock_spell(spell_id: str, request: Request, session: dict = Depends(require_me)) -> SpellUnlockResponse:
    """魔法を解放（SC-32・SP 消費）。前提/SP/二重解放はサーバー強制。"""
    verify_origin(request)
    verify_csrf(request)
    result = gami_service.unlock_spell(uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), spell_id)
    return SpellUnlockResponse(**result)
