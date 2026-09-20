"""情報インプットルータ（`/api/v1`・テナントプレーン・ドメイン N）。

認可は Depends(require_me)＝会社内 active 一般ユーザー（情報プールは会社横断の知識レイヤ・N.0＝クエスト門番ではない）。
会社/アカウントはセッション由来（§1.5・company_id はクエリで受けない）。本スライスは Phase A＝読み取り（一覧・ワードクラウド）のみ。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile

from app.control_plane.admin.deps import require_company_account_admin
from app.control_plane.me.deps import require_me
from app.core.deps import verify_csrf, verify_origin
from app.tenant.info import application as info_service
from app.tenant.info.schemas import (
    InfoAttachmentsResponse,
    InfoCreateRequest,
    InfoCuratorGrantRequest,
    InfoCuratorsResponse,
    InfoDetailDTO,
    InfoImageUploadResponse,
    InfoLinkCandidatesResponse,
    InfoLinkCreateRequest,
    InfoLinkDTO,
    InfoLinkKindRequest,
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


@router.post("/info-items/images", response_model=InfoImageUploadResponse, status_code=201)
async def rehost_info_image(
    request: Request,
    file: UploadFile = File(...),
    session: dict = Depends(require_me),
) -> InfoImageUploadResponse:
    """貼付画像の再ホスト（SC-51・N.2・§12-4）＝multipart・全ユーザー。自社ホスト署名URL を返す。

    静的パス（`/info-items/images`）＝動的 `/info-items/{info_id}` より前に定義（優先ルーティング）。
    """
    verify_origin(request)
    verify_csrf(request)
    data = await file.read()
    result = info_service.rehost_image(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        data=data, content_type=file.content_type or "",
    )
    return InfoImageUploadResponse(**result)


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


@router.post("/info-items/{info_id}/archive", response_model=InfoDetailDTO)
def archive_info_item(info_id: str, request: Request, session: dict = Depends(require_me)) -> InfoDetailDTO:
    """アーカイブ（論理削除・N.2）＝curator のみ。物理削除なし（監査保持）。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.archive_info_item(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id)
    return InfoDetailDTO(**result)


@router.post("/info-items/{info_id}/unarchive", response_model=InfoDetailDTO)
def unarchive_info_item(info_id: str, request: Request, session: dict = Depends(require_me)) -> InfoDetailDTO:
    """アーカイブ解除（N.2）＝curator のみ。curated（or raw）へ戻す。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.unarchive_info_item(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id)
    return InfoDetailDTO(**result)


@router.delete("/info-items/{info_id}", status_code=204)
def delete_info_item(info_id: str, request: Request, session: dict = Depends(require_me)) -> None:
    """未判定（raw）の物理削除（N.2）＝登録者本人のみ。curated 済みは 409（archive へ誘導）。"""
    verify_origin(request)
    verify_csrf(request)
    info_service.delete_info_item(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id)


# ---- 参考資料（info_attachments・N.2・§5.33＝内容群＝作成者のみ）----


@router.post("/info-items/{info_id}/attachments", response_model=InfoAttachmentsResponse, status_code=201)
async def add_info_attachments(
    info_id: str,
    request: Request,
    files: list[UploadFile] = File(...),
    session: dict = Depends(require_me),
) -> InfoAttachmentsResponse:
    """参考資料を追加（SC-51/SC-52・N.2・multipart）＝作成者のみ。検証はサーバー強制（§1.10・拡張子/サイズ/マジックバイト）。"""
    verify_origin(request)
    verify_csrf(request)
    payloads = [((f.filename or ""), await f.read()) for f in files]
    result = info_service.add_attachments(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id, files=payloads,
    )
    return InfoAttachmentsResponse(**result)


@router.delete("/info-items/{info_id}/attachments/{attachment_id}", status_code=204)
def remove_info_attachment(
    info_id: str,
    attachment_id: str,
    request: Request,
    session: dict = Depends(require_me),
) -> None:
    """参考資料を削除（N.2）＝作成者のみ。DB 行＋MinIO オブジェクト削除。"""
    verify_origin(request)
    verify_csrf(request)
    info_service.remove_attachment(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), info_id, attachment_id,
    )


# ---- 情報判定権限（info_curator）の付与/剥奪（N.5・会社アカウント管理者/system_admin・SC-90 系に同居）----


@router.get("/info-curators", response_model=InfoCuratorsResponse)
def list_info_curators(request: Request, session: dict = Depends(require_company_account_admin)) -> InfoCuratorsResponse:
    """情報判定権限の一覧（N.5）＝会社アカウント管理者/system_admin。セッション会社スコープ固定。読取専用。"""
    result = info_service.list_info_curators(uuid.UUID(session["company_id"]))
    return InfoCuratorsResponse(**result)


@router.post("/info-curators", response_model=InfoCuratorsResponse, status_code=201)
def grant_info_curator(
    body: InfoCuratorGrantRequest,
    request: Request,
    session: dict = Depends(require_company_account_admin),
) -> InfoCuratorsResponse:
    """情報判定権限を付与（N.5）＝会社アカウント管理者/system_admin。二重付与は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.grant_info_curator(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), body.account_id)
    return InfoCuratorsResponse(**result)


@router.delete("/info-curators/{account_id}", status_code=204)
def revoke_info_curator(
    account_id: str,
    request: Request,
    session: dict = Depends(require_company_account_admin),
) -> None:
    """情報判定権限を剥奪（N.5・論理）＝会社アカウント管理者/system_admin。"""
    verify_origin(request)
    verify_csrf(request)
    info_service.revoke_info_curator(uuid.UUID(session["company_id"]), account_id)


# ---- 関連リンク（/info-links・N.3・情報側＝会社内 active 全員）----


@router.get("/info-link-candidates", response_model=InfoLinkCandidatesResponse)
def link_candidates(
    request: Request,
    target_type: str,
    q: str | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    session: dict = Depends(require_me),
) -> InfoLinkCandidatesResponse:
    """リンク候補（成果物をタイトル検索して target_id 解決・SC-52・N.3）。会社内 active ユーザー。読取専用。"""
    result = info_service.get_link_candidates(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]),
        target_type=target_type, q=q, limit=limit)
    return InfoLinkCandidatesResponse(**result)


@router.post("/info-links", response_model=InfoLinkDTO, status_code=201)
def add_info_link(
    body: InfoLinkCreateRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> InfoLinkDTO:
    """手動リンク追加（SC-52・N.3）＝会社内 active 全員・origin=manual。同一 (info,target) は 409。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.add_link(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), body=body)
    return InfoLinkDTO(**result)


@router.patch("/info-links/{link_id}", response_model=InfoLinkDTO)
def change_info_link_kind(
    link_id: str,
    body: InfoLinkKindRequest,
    request: Request,
    session: dict = Depends(require_me),
) -> InfoLinkDTO:
    """種別変更（関連↔裏付け↔反証・N.3）。全員。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.change_link_kind(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), link_id, kind=body.kind)
    return InfoLinkDTO(**result)


@router.post("/info-links/{link_id}/reject", response_model=InfoLinkDTO)
def reject_info_link(link_id: str, request: Request, session: dict = Depends(require_me)) -> InfoLinkDTO:
    """棄却（rejected_at セット・行は残す・N.3/§N.6）。全員。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.reject_link(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), link_id)
    return InfoLinkDTO(**result)


@router.post("/info-links/{link_id}/unreject", response_model=InfoLinkDTO)
def unreject_info_link(link_id: str, request: Request, session: dict = Depends(require_me)) -> InfoLinkDTO:
    """棄却の取消（rejected_at を NULL）。全員。"""
    verify_origin(request)
    verify_csrf(request)
    result = info_service.unreject_link(
        uuid.UUID(session["account_id"]), uuid.UUID(session["company_id"]), link_id)
    return InfoLinkDTO(**result)
