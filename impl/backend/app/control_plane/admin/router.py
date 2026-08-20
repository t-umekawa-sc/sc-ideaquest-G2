"""アカウント管理ルータ（`/api/v1/admin`・imperative shell・ドメイン B）。

認可は Depends(require_system_admin)（B.0.1）。GET は CSRF 免除（A.1・状態変更なし）。
業務判断は application 層。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile

from app.control_plane.admin import application as admin_service
from app.control_plane.admin import company_application as company_service
from app.control_plane.admin import quest_group_application as qg_service
from app.control_plane.admin.deps import (
    require_company_account_admin,
    require_qg_admin_actor,
    require_system_admin,
)
from app.control_plane.admin.schemas import (
    AccountCreateRequest,
    AccountCreateSelfRequest,
    AccountListResponse,
    AccountResponse,
    AccountUpdateRequest,
    AccountUpdateSelfRequest,
    CompanyCreateRequest,
    CompanyDetail,
    CompanyListResponse,
    CompanyProfileUpdateRequest,
    CompanySettingsUpdateRequest,
    DirectoryResponse,
    MemberAddRequest,
    MemberListResponse,
    MembershipResponse,
    PasswordResetResponse,
    QuestGroupCreateRequest,
    QuestGroupListItem,
    QuestGroupListResponse,
    QuestGroupRenameRequest,
)
from app.core.deps import verify_csrf, verify_origin
from app.infra.cache import get_redis

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def _company_id(session: dict) -> uuid.UUID:
    """会社アカウント管理者 EP のスコープ＝セッション会社固定（B.2.1・`company_id` を受けない）。"""
    return uuid.UUID(session["company_id"])


# --- 会社 CRUD（`/admin/companies`・system_admin・B.1・SC-91/92） ----------------------------
@router.get("/companies", response_model=CompanyListResponse)
def list_companies(
    request: Request,
    q: str | None = None,
    status: str | None = None,  # enum 多値（`active,suspended`）＝値検証は application（§1.8.1②）
    sort: str | None = None,
    account_count_min: int | None = Query(default=None, ge=0),
    account_count_max: int | None = Query(default=None, ge=0),
    format: str | None = None,   # `csv` で CSV エクスポート（§1.8.1③）
    columns: str | None = None,  # CSV の表示列・列順（§1.8.1③）
    pin_ids: str | None = None,  # 固定行（ピン）ID＝ページ/絞込跨ぎで解決（§1.8.1④）
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    _session: dict = Depends(require_system_admin),
):
    """会社一覧（SC-91・system_admin 専用）＋複数ソート/項目別フィルタ/CSV/固定行 契約（§1.8.1①②③④）。"""
    if format == "csv":  # 同一フィルタ/ソートの全件を CSV で（監査対象・§1.8.1③）
        content, filename = company_service.export_companies_csv(
            q=q, status=status, sort=sort,
            account_count_min=account_count_min, account_count_max=account_count_max, columns=columns)
        return Response(content=content, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    return CompanyListResponse(**company_service.list_companies(
        q=q, status=status, sort=sort,
        account_count_min=account_count_min, account_count_max=account_count_max,
        pin_ids=pin_ids, page=page, per_page=per_page))


@router.post("/companies", response_model=CompanyDetail, status_code=201)
def create_company(
    body: CompanyCreateRequest, request: Request, _session: dict = Depends(require_system_admin),
) -> CompanyDetail:
    """会社作成（SC-91・`status=suspended` で作成・code/db_identifier 一意）。"""
    verify_origin(request)
    verify_csrf(request)
    return CompanyDetail(**company_service.create_company(
        name=body.name, company_code=body.company_code, db_identifier=body.db_identifier,
        color=body.color, icon_image_path=body.icon_image_path,
    ))


@router.get("/companies/{company_id}", response_model=CompanyDetail)
def get_company(
    company_id: uuid.UUID, request: Request, _session: dict = Depends(require_system_admin),
) -> CompanyDetail:
    """会社詳細（SC-92）。"""
    return CompanyDetail(**company_service.get_company_detail(company_id))


@router.patch("/companies/{company_id}", response_model=CompanyDetail)
def update_company(
    company_id: uuid.UUID, body: CompanyProfileUpdateRequest, request: Request,
    _session: dict = Depends(require_system_admin),
) -> CompanyDetail:
    """会社プロフィール更新（SC-92・name/color/icon）。"""
    verify_origin(request)
    verify_csrf(request)
    return CompanyDetail(**company_service.update_company_profile(
        company_id, body.model_dump(exclude_unset=True)
    ))


@router.put("/companies/{company_id}/icon-image", response_model=CompanyDetail)
async def put_company_icon(
    company_id: uuid.UUID, request: Request, file: UploadFile = File(...),
    _session: dict = Depends(require_system_admin),
) -> CompanyDetail:
    """会社アイコン画像を設定（SC-91/92・B.1・§1.10・multipart）。管理DB companies 直接更新＋署名URL 返却。"""
    verify_origin(request)
    verify_csrf(request)
    data = await file.read()
    return CompanyDetail(**company_service.set_company_icon(
        company_id, data=data, content_type=file.content_type or "",
    ))


@router.delete("/companies/{company_id}/icon-image", status_code=204)
def delete_company_icon(
    company_id: uuid.UUID, request: Request, _session: dict = Depends(require_system_admin),
) -> None:
    """会社アイコン画像を削除（既定＝頭文字＋会社カラーへ・B.1）。"""
    verify_origin(request)
    verify_csrf(request)
    company_service.delete_company_icon(company_id)


@router.patch("/companies/{company_id}/settings", response_model=CompanyDetail)
def update_company_settings(
    company_id: uuid.UUID, body: CompanySettingsUpdateRequest, request: Request,
    _session: dict = Depends(require_system_admin),
) -> CompanyDetail:
    """会社設定フラグ更新（SC-92・記名時は非開示を無効化して整合）。"""
    verify_origin(request)
    verify_csrf(request)
    return CompanyDetail(**company_service.update_company_settings(
        company_id, body.model_dump(exclude_unset=True)
    ))


@router.get("/companies/{company_id}/quest-groups", response_model=QuestGroupListResponse)
def list_company_quest_groups(
    company_id: uuid.UUID, request: Request, _session: dict = Depends(require_system_admin),
) -> QuestGroupListResponse:
    """会社のクエストグループ候補一覧（SC-92・B.3・system_admin 専用・所属割当の候補）。"""
    return QuestGroupListResponse(**company_service.list_company_quest_groups(company_id))


@router.post("/companies/{company_id}/quest-groups", response_model=QuestGroupListItem, status_code=201)
def create_company_quest_group(
    company_id: uuid.UUID, body: QuestGroupCreateRequest, request: Request,
    _session: dict = Depends(require_system_admin),
) -> QuestGroupListItem:
    """クエストグループを作成（SC-92・B.3・system_admin 専用）。変更系＝Origin/CSRF 必須（P3）。"""
    verify_origin(request)
    verify_csrf(request)
    return QuestGroupListItem(**company_service.create_company_quest_group(
        company_id, quest_group_code=body.quest_group_code, name=body.name,
    ))


@router.patch("/companies/{company_id}/quest-groups/{group_id}", response_model=QuestGroupListItem)
def rename_company_quest_group(
    company_id: uuid.UUID, group_id: uuid.UUID, body: QuestGroupRenameRequest, request: Request,
    _session: dict = Depends(require_system_admin),
) -> QuestGroupListItem:
    """クエストグループをリネーム（SC-92・B.3.1・system_admin・`name` のみ）。変更系＝Origin/CSRF 必須（P3）。"""
    verify_origin(request)
    verify_csrf(request)
    return QuestGroupListItem(**company_service.rename_company_quest_group(
        company_id, group_id, name=body.name,
    ))


@router.delete("/companies/{company_id}/quest-groups/{group_id}", status_code=204)
def delete_company_quest_group(
    company_id: uuid.UUID, group_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> None:
    """クエストグループを削除（SC-92・B.3.1・空グループのみ・トゥームストーン）。変更系＝Origin/CSRF 必須（P3）。"""
    verify_origin(request)
    verify_csrf(request)
    company_service.delete_company_quest_group(company_id, group_id)


@router.get("/companies/{company_id}/accounts", response_model=AccountListResponse)
def list_company_accounts(
    company_id: uuid.UUID,
    request: Request,
    q: str | None = None,
    status: str | None = None,  # enum 多値（`active,disabled`）＝値検証は application（§1.8.1②）
    system_role: str | None = None,  # enum 多値（general/company_account_admin/system_admin）（§1.8.1②）
    sort: str | None = None,  # 複数ソート（§1.8.1①）
    pin_ids: str | None = None,  # 固定行（ピン）ID＝ページ/絞込跨ぎで解決（§1.8.1④）
    format: str | None = None,   # `csv` で CSV エクスポート（§1.8.1③）
    columns: str | None = None,  # CSV の表示列・列順（§1.8.1③）
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    _session: dict = Depends(require_system_admin),
):
    """会社のアカウント一覧（SC-92・B.2・system_admin 専用）＋複数ソート/enum 多値フィルタ/CSV/固定行（§1.8.1①②③④）。"""
    if format == "csv":  # 同一フィルタ/ソートの全件を CSV で（監査対象・§1.8.1③）
        content, filename = admin_service.export_accounts_csv(
            company_id, q=q, status=status, system_role=system_role, sort=sort, columns=columns)
        return Response(content=content, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    return AccountListResponse(**admin_service.list_company_accounts(
        company_id, q=q, status=status, system_role=system_role, sort=sort, pin_ids=pin_ids,
        page=page, per_page=per_page))


@router.post("/companies/{company_id}/accounts", response_model=AccountResponse, status_code=201)
def issue_company_account(
    company_id: uuid.UUID,
    body: AccountCreateRequest,
    request: Request,
    _session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウントを発行（SC-92・B.2・system_admin 専用）。変更系＝Origin/CSRF 必須（B.0.1 P3）。"""
    verify_origin(request)      # 認可（Depends）の後に CSRF/Origin（P3）
    verify_csrf(request)
    result = admin_service.issue_account(
        company_id,
        display_name=body.display_name, login_id=body.login_id, email=body.email,
        system_role=body.system_role, locale=body.locale,
        memberships=[{"group_id": str(m.group_id), "role": m.role} for m in body.memberships],
    )
    return AccountResponse(**result)


@router.patch("/companies/{company_id}/accounts/{account_id}", response_model=AccountResponse)
def edit_company_account(
    company_id: uuid.UUID, account_id: uuid.UUID, body: AccountUpdateRequest, request: Request,
    session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウント編集（SC-92・B.2・差分・system_admin 専用）。変更系＝Origin/CSRF 必須（B.0.1 P3）。"""
    verify_origin(request)
    verify_csrf(request)
    result = admin_service.edit_account(
        company_id, account_id,
        changes=body.model_dump(exclude_unset=True),   # 指定フィールドのみ差分適用
        acting_account_id=session["account_id"], r=get_redis(),
    )
    return AccountResponse(**result)


@router.post("/companies/{company_id}/accounts/{account_id}/disable", response_model=AccountResponse)
def disable_account(
    company_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウント無効化（B.2・全セッション破棄＋信頼端末失効・`last_system_admin` 拒否）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.disable_account(company_id, account_id, get_redis()))


@router.post("/companies/{company_id}/accounts/{account_id}/enable", response_model=AccountResponse)
def enable_account(
    company_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> AccountResponse:
    """アカウント再有効化（B.2）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.enable_account(company_id, account_id))


@router.post("/companies/{company_id}/accounts/{account_id}/password-reset", response_model=PasswordResetResponse)
def password_reset(
    company_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    _session: dict = Depends(require_system_admin),
) -> PasswordResetResponse:
    """初回/再設定PWリンクを再送（B.2・A.7・旧リンク失効・非同期送信）。"""
    verify_origin(request)
    verify_csrf(request)
    return PasswordResetResponse(**admin_service.reset_password(company_id, account_id))


# --- 会社アカウント管理者（`/admin/accounts`・セッション会社固定・B.2.1） ---------------------
@router.get("/accounts", response_model=AccountListResponse)
def list_own_accounts(
    request: Request,
    q: str | None = None,
    status: str | None = None,  # enum 多値（値検証は application・§1.8.1②）
    system_role: str | None = None,  # enum 多値（§1.8.1②）
    sort: str | None = None,  # 複数ソート（§1.8.1①）
    pin_ids: str | None = None,  # 固定行（ピン）ID（§1.8.1④）
    format: str | None = None,   # `csv` で CSV エクスポート（§1.8.1③）
    columns: str | None = None,  # CSV の表示列・列順（§1.8.1③）
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    session: dict = Depends(require_company_account_admin),
):
    """自社アカウント一覧（SC-93・B.2.1）＝B.2 と同形の契約（複数ソート/enum 多値フィルタ/CSV/固定行・§1.8.1①②③④）。"""
    company_id = _company_id(session)
    if format == "csv":  # 監査対象・§1.8.1③
        content, filename = admin_service.export_accounts_csv(
            company_id, q=q, status=status, system_role=system_role, sort=sort, columns=columns)
        return Response(content=content, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    return AccountListResponse(**admin_service.list_company_accounts(
        company_id, q=q, status=status, system_role=system_role, sort=sort, pin_ids=pin_ids,
        page=page, per_page=per_page))


@router.post("/accounts", response_model=AccountResponse, status_code=201)
def issue_own_account(
    body: AccountCreateSelfRequest, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント発行（B.2.1・`system_role=general` 固定＝ロール付与は不可）。"""
    verify_origin(request)
    verify_csrf(request)
    result = admin_service.issue_account(
        _company_id(session),
        display_name=body.display_name, login_id=body.login_id, email=body.email,
        system_role="general", locale=body.locale,   # 会社アカ管理者は general のみ（B.2.1）
        memberships=[{"group_id": str(m.group_id), "role": m.role} for m in body.memberships],  # admin 任命可（B.2.1）
    )
    return AccountResponse(**result)


@router.patch("/accounts/{account_id}", response_model=AccountResponse)
def edit_own_account(
    account_id: uuid.UUID, body: AccountUpdateSelfRequest, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント編集（B.2.1・`system_role` 変更不可＝DTO が受け取らない）。"""
    verify_origin(request)
    verify_csrf(request)
    result = admin_service.edit_account(
        _company_id(session), account_id,
        changes=body.model_dump(exclude_unset=True),
        acting_account_id=session["account_id"], r=get_redis(),
    )
    return AccountResponse(**result)


@router.post("/accounts/{account_id}/disable", response_model=AccountResponse)
def disable_own_account(
    account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント無効化（B.2.1・**system_admin は無効化不可**＝403）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.disable_account(
        _company_id(session), account_id, get_redis(), forbid_system_admin_target=True
    ))


@router.post("/accounts/{account_id}/enable", response_model=AccountResponse)
def enable_own_account(
    account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> AccountResponse:
    """自社アカウント再有効化（B.2.1）。"""
    verify_origin(request)
    verify_csrf(request)
    return AccountResponse(**admin_service.enable_account(_company_id(session), account_id))


@router.post("/accounts/{account_id}/password-reset", response_model=PasswordResetResponse)
def password_reset_own_account(
    account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_company_account_admin),
) -> PasswordResetResponse:
    """自社アカウントのPWリンク再送（B.2.1・A.7）。"""
    verify_origin(request)
    verify_csrf(request)
    return PasswordResetResponse(**admin_service.reset_password(_company_id(session), account_id))


@router.get("/company-quest-groups", response_model=QuestGroupListResponse)
def list_own_company_quest_groups(
    request: Request, session: dict = Depends(require_company_account_admin),
) -> QuestGroupListResponse:
    """自社のクエストグループ一覧（B.2.1・所属エディタの候補・セッション会社固定）。読み取りのみ。"""
    return QuestGroupListResponse(**company_service.list_company_quest_groups(_company_id(session)))


# --- QG管理者（`/admin/quest-groups`・`/admin/company-directory`・セッション会社固定・B.4・SC-90） ---
@router.get("/quest-groups", response_model=QuestGroupListResponse)
def list_admin_quest_groups(
    request: Request, session: dict = Depends(require_qg_admin_actor),
) -> QuestGroupListResponse:
    """自分が `admin` のグループ一覧（SC-90・member_count 付き・admin 所属ゼロは 403）。"""
    return QuestGroupListResponse(**qg_service.list_admin_groups(session))


@router.get("/quest-groups/{group_id}/members", response_model=MemberListResponse)
def list_quest_group_members(
    group_id: uuid.UUID, request: Request, q: str | None = None,
    session: dict = Depends(require_qg_admin_actor),
) -> MemberListResponse:
    """グループの参加メンバー一覧（当該グループの admin のみ・非 admin/不明は 404 存在秘匿）。"""
    return MemberListResponse(**qg_service.list_members(session, group_id, q=q))


@router.get("/company-directory", response_model=DirectoryResponse)
def company_directory(
    request: Request, q: str | None = None,
    page: int = Query(default=1, ge=1), per_page: int = Query(default=20, ge=1, le=100),
    session: dict = Depends(require_qg_admin_actor),
) -> DirectoryResponse:
    """自社アカウント・ディレクトリ（最小射影・QG管理者のみ＝admin 所属ゼロは 403）。"""
    return DirectoryResponse(**qg_service.company_directory(session, q=q, page=page, per_page=per_page))


@router.post("/quest-groups/{group_id}/members", response_model=MembershipResponse, status_code=201)
def add_quest_group_member(
    group_id: uuid.UUID, body: MemberAddRequest, request: Request,
    session: dict = Depends(require_qg_admin_actor),
) -> MembershipResponse:
    """既存アカウントを自グループに参加追加（`role=member` 固定・SoD）。変更系＝Origin/CSRF 必須（P3）。"""
    verify_origin(request)
    verify_csrf(request)
    return MembershipResponse(**qg_service.add_member(session, group_id, body.account_id))


@router.delete("/quest-groups/{group_id}/members/{account_id}", status_code=204)
def remove_quest_group_member(
    group_id: uuid.UUID, account_id: uuid.UUID, request: Request,
    session: dict = Depends(require_qg_admin_actor),
) -> None:
    """自グループから除外（per-group トゥームストーン・204・冪等・アカウント本体は不変・SoD）。"""
    verify_origin(request)
    verify_csrf(request)
    qg_service.remove_member(session, group_id, account_id)
