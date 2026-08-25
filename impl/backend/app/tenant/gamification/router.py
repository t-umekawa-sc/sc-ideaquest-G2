"""ゲーミフィケーション ルータ（`/api/v1`・テナントプレーン・ドメイン G）＝魔法カタログ/解放（SC-32・E.4 前提）。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.gamification import application as gami_service
from app.tenant.gamification.schemas import SpellCatalogResponse, SpellUnlockResponse

router = APIRouter(prefix="/api/v1", tags=["gamification"])


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
