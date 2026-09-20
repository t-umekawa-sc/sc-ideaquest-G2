"""情報インプットルータ（`/api/v1`・テナントプレーン・ドメイン N）。

認可は Depends(require_me)＝会社内 active 一般ユーザー（情報プールは会社横断の知識レイヤ・N.0＝クエスト門番ではない）。
会社/アカウントはセッション由来（§1.5・company_id はクエリで受けない）。本スライスは Phase A＝読み取り（一覧・ワードクラウド）のみ。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.tenant.info import application as info_service
from app.tenant.info.schemas import InfoListResponse, WordCloudResponse

router = APIRouter(prefix="/api/v1", tags=["info"])


@router.get("/info-items/word-cloud", response_model=WordCloudResponse)
def get_word_cloud(
    request: Request,
    limit: int = Query(default=40, ge=1, le=200),
    session: dict = Depends(require_me),
) -> WordCloudResponse:
    """ワードクラウド＝保存済みトークンの頻度集計（SC-50・N.6）。読取専用。

    `/info-items/{id}`（Phase B）より前に定義＝静的パスを動的パスに優先させる。
    """
    result = info_service.get_word_cloud(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), limit=limit)
    return WordCloudResponse(**result)


@router.get("/info-items", response_model=InfoListResponse)
def list_info_items(
    request: Request,
    q: str | None = None,
    status: str | None = None,          # enum 多値（カンマ）・既定は archived 除外
    priority: str | None = None,        # enum 多値（カンマ）
    source: str | None = None,          # enum 多値（カンマ）
    impact_class: str | None = None,    # enum 多値（カンマ）
    roots_only: bool = False,           # 続報を束ねる＝根のみ（§12-1）
    sort: str | None = None,            # created_at/title/status/priority/due_date/link_count（未知は 422）
    page: int | None = Query(default=None, ge=1),
    per_page: int | None = Query(default=None, ge=1, le=100),
    session: dict = Depends(require_me),
) -> InfoListResponse:
    """情報一覧（SC-50・N.1）＝DataTable サーバー委譲（番号ページャ・§1.8.1）。会社内 active ユーザーは閲覧可。読取専用。"""
    result = info_service.get_info_items(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        q=q, status=status, priority=priority, source=source, impact_class=impact_class,
        roots_only=roots_only, sort=sort, page=page, per_page=per_page,
    )
    return InfoListResponse(**result)
