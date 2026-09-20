"""情報インプットルータ（`/api/v1`・テナントプレーン・ドメイン N）。

認可は Depends(require_me)＝会社内 active 一般ユーザー（情報プールは会社横断の知識レイヤ・N.0＝クエスト門番ではない）。
会社/アカウントはセッション由来（§1.5・company_id はクエリで受けない）。本スライスは Phase A＝読み取り（一覧・ワードクラウド）のみ。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.info import application as info_service
from app.tenant.info.schemas import (
    InfoCreateRequest,
    InfoDetailDTO,
    InfoListResponse,
    InfoUpdateRequest,
    WordCloudResponse,
)

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


@router.get("/info-items/{info_id}", response_model=InfoDetailDTO)
def get_info_item_detail(
    info_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> InfoDetailDTO:
    """情報詳細（SC-52・N.1）＝全属性＋関連リンク＋続報スレッド＋ミニ・ワードクラウド＋`can`。読取専用。

    静的パス `/info-items/word-cloud` より後に定義（動的パスに優先させる）。不在/他テナントは 404。
    """
    result = info_service.get_info_detail(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id)
    return InfoDetailDTO(**result)


# ---- 変更系（SC-51・N.2）。認可＝require_me＋Origin/CSRF（§2.2）。業務ルールは application 強制 ----


@router.post("/info-items", response_model=InfoDetailDTO, status_code=201)
def create_info_item(
    body: InfoCreateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> InfoDetailDTO:
    """低摩擦登録／続報登録（SC-51・N.2）＝全ユーザー。保存時にサニタイズ→body_text→要約→トークン再生成。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.create_info_item(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), body=body)
    return InfoDetailDTO(**result)


@router.patch("/info-items/{info_id}", response_model=InfoDetailDTO)
def update_info_item(
    info_id: str,
    body: InfoUpdateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> InfoDetailDTO:
    """情報の部分更新（SC-52/SC-51・N.2）＝内容は作成者／キュレーションは curator（越権 403）。内容変更は履歴に記録。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.update_info_item(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id, body=body)
    return InfoDetailDTO(**result)
