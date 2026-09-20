"""ドメイン N（情報インプット）の application（imperative shell・API設計 N.1/N.6）。

会社DB を動的解決（§1.5・company_id はセッション由来）→ 一覧/ワードクラウドを DTO 化して返す。
情報プールは会社（テナント）横断の知識レイヤ＝クエスト門番ではなく **会社内 active ユーザーなら閲覧可**（N.0）。
本スライスは Phase A＝読み取り経路（一覧＝DataTable サーバー委譲・ワードクラウド）のみ。登録/属性は Phase C。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core import list_query as lq
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.storage import get_storage
from app.tenant.info import repository as repo
from app.tenant.info.schemas import (
    IMPACT_CLASS_VALUES,
    PRIORITY_VALUES,
    SOURCE_VALUES,
    STATUS_VALUES,
)
from app.tenant.profile import repository as profile_repo

_EMPTY_PAGE = {
    "data": [],
    "page_info": {"total": 0, "page": 1, "per_page": lq.DEFAULT_PER_PAGE},
    "facets": {"all": 0, "raw": 0, "curated": 0},
}


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _image_url(path: str | None) -> str | None:
    """MinIO キー→短TTL 署名URL（§1.10）。未設定は None。"""
    return get_storage().presigned_get(path) if path else None


def _creator_dto(user) -> dict:
    if user is None:
        return {"user_id": "", "display_name": "", "avatar_image_url": None}
    return {
        "user_id": str(user.id),
        "display_name": user.display_name,
        "avatar_image_url": _image_url(user.avatar_image_path),
    }


def _card_dto(item, *, creator, categories, link_count, follow_up_count) -> dict:
    return {
        "id": str(item.id),
        "parent_info_id": str(item.parent_info_id) if item.parent_info_id else None,
        "title": item.title,
        "summary": item.summary,
        "status": item.status,
        "priority": item.priority,
        "source": item.source,
        "classification": item.classification,
        "scope": item.scope,
        "impact_class": item.impact_class,
        "categories": categories,
        "source_url": item.source_url,
        "due_date": item.due_date,
        "created_by": _creator_dto(creator),
        "created_at": item.created_at,
        "link_count": link_count,
        "follow_up_count": follow_up_count,
    }


def get_info_items(
    account_id: uuid.UUID,
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    source: str | None = None,
    impact_class: str | None = None,
    roots_only: bool = False,
    sort: str | None = None,
    page: int | None = None,
    per_page: int | None = None,
) -> dict:
    """情報一覧（SC-50・N.1）＝DataTable サーバー委譲（番号ページャ・§1.8.1）。会社内 active ユーザーは閲覧可（N.0）。

    フィルタ enum（status/priority/source/impact_class）と sort キーはホワイトリスト検証（未知値は 422）。
    既定は archived 除外・新着（`-created_at`）。
    """
    statuses = lq.parse_enum(status, "status", STATUS_VALUES)
    priorities = lq.parse_enum(priority, "priority", PRIORITY_VALUES)
    sources = lq.parse_enum(source, "source", SOURCE_VALUES)
    impact_classes = lq.parse_enum(impact_class, "impact_class", IMPACT_CLASS_VALUES)

    company = _resolve_company(company_id)
    if company is None:
        return _EMPTY_PAGE
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return _EMPTY_PAGE
        rows_stmt, count_stmt = repo.build_info_list_query(
            q=q, statuses=statuses, priorities=priorities, sources=sources,
            impact_classes=impact_classes, roots_only=roots_only,
            sort=sort,  # 未知 sort キーは 422（list_query）
        )
        total = ts.execute(count_stmt).scalar_one()
        facets = repo.status_counts(
            ts, q=q, priorities=priorities, sources=sources,
            impact_classes=impact_classes, roots_only=roots_only,
        )
        if page is None and per_page is None:
            rows = list(ts.execute(rows_stmt).scalars().all())
            eff_page, eff_per = 1, total or 1
        else:
            eff_page = max(1, page or 1)
            eff_per = max(1, min(per_page or lq.DEFAULT_PER_PAGE, lq.MAX_PER_PAGE))
            rows = list(ts.execute(rows_stmt.offset((eff_page - 1) * eff_per).limit(eff_per)).scalars().all())

        ids = [r.id for r in rows]
        link_counts = repo.link_counts_for_items(ts, ids)
        follow_counts = repo.follow_up_counts_for_items(ts, ids)
        cats = repo.categories_for_items(ts, ids)
        creators = repo.users_by_ids(ts, list({r.created_by_id for r in rows}))
        data = [
            _card_dto(
                r,
                creator=creators.get(r.created_by_id),
                categories=cats.get(r.id, []),
                link_count=link_counts.get(r.id, 0),
                follow_up_count=follow_counts.get(r.id, 0),
            )
            for r in rows
        ]
    return {"data": data, "page_info": {"total": total, "page": eff_page, "per_page": eff_per},
            "facets": facets}


def get_word_cloud(account_id: uuid.UUID, company_id: uuid.UUID, *, limit: int = 40) -> dict:
    """ワードクラウド（SC-50・N.6・§5.36）＝保存済みトークンの頻度集計（archived 除外・count 降順）。"""
    if limit < 1:
        raise AppError(422, "validation_error", detail="limit が不正です", errors=[{"field": "limit"}])
    limit = min(limit, 200)
    company = _resolve_company(company_id)
    if company is None:
        return {"tokens": []}
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return {"tokens": []}
        tokens = repo.word_cloud(ts, limit=limit)
    return {"tokens": tokens}
