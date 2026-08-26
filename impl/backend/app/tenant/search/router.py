"""全文検索ルータ（`/api/v1`・テナントプレーン・ドメイン J）＝SC-12 全文検索タブ。

認可＝Depends(require_me)。読取専用。門番＝パーティー∩グループ AND（application で 404・存在秘匿）。
グローバル `GET /search` は予約（本スライス対象外）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query

from app.control_plane.me.deps import require_me
from app.tenant.search import application as svc

router = APIRouter(prefix="/api/v1", tags=["search"])


@router.get("/quests/{quest_id}/search")
def search_quest(
    quest_id: str,
    q: str = Query(..., description="検索語（必須・PGroonga クエリ）"),
    types: str | None = Query(default=None, description="idea,chat,attachment の CSV（既定 all）"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    session: dict = Depends(require_me),
) -> dict:
    """クエスト内 全文検索（SC-12・J.1）＝3 種 UNION・score 順・オフセットページング。"""
    return svc.search_quest(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), quest_id,
        q=q, types=types, page=page, per_page=per_page,
    )
