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


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def _thread_item_dto(item, creators) -> dict:
    u = creators.get(item.created_by_id)
    return {"id": str(item.id), "title": item.title,
            "created_by": u.display_name if u else None, "created_at": item.created_at}


def _detail_dto(item, *, categories, links, title_map, parent, follow_ups, creators, tokens, can) -> dict:
    return {
        "id": str(item.id),
        "parent_info_id": str(item.parent_info_id) if item.parent_info_id else None,
        "title": item.title,
        "body_html": item.body_html,
        "summary": item.summary,
        "source_url": item.source_url,
        "due_date": item.due_date,
        "status": item.status,
        "priority": item.priority,
        "source": item.source,
        "classification": item.classification,
        "scope": item.scope,
        "target_business": item.target_business,
        "impact_level": item.impact_level,
        "impact_class": item.impact_class,
        "impact_timing": item.impact_timing,
        "triaged_on": item.triaged_on,
        "triage": item.triage,
        "triage_reason": item.triage_reason,
        "categories": categories,
        "created_by": _creator_dto(creators.get(item.created_by_id)),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "links": [{
            "id": str(l.id), "target_type": l.target_type, "target_id": str(l.target_id),
            "target_title": title_map.get(l.target_id),
            "kind": l.kind, "origin": l.origin,
            "score": float(l.score) if l.score is not None else None,
            "rejected": l.rejected_at is not None,
        } for l in links],
        "thread": {
            "parent": _thread_item_dto(parent, creators) if parent else None,
            "follow_ups": [_thread_item_dto(f, creators) for f in follow_ups],
        },
        "tokens_top": tokens,
        "can": can,
    }


def get_info_detail(account_id: uuid.UUID, company_id: uuid.UUID, info_id: str) -> dict:
    """情報詳細（SC-52・N.1）＝全属性＋categories＋links〔target_title 解決〕＋thread＋tokens_top＋can。

    会社内 active ユーザーは閲覧可（N.0）。不在/他テナントは 404（存在秘匿）。`can` はサーバー算出
    （内容=作成者／キュレーション=curator／リンク=全員）＝フロントは反映のみ・変更系で再検証。
    """
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    iid = _parse_uuid(info_id, field="info_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        item = repo.get_info_item(ts, iid)
        if item is None:
            raise AppError(404, "not_found")
        categories = repo.categories_for_items(ts, [item.id]).get(item.id, [])
        links = repo.links_for_item(ts, item.id)
        title_map = repo.resolve_link_titles(ts, links)
        follow_ups = repo.follow_up_items(ts, item.id)
        parent = repo.get_info_item(ts, item.parent_info_id) if item.parent_info_id else None
        uids = {item.created_by_id} | {f.created_by_id for f in follow_ups}
        if parent:
            uids.add(parent.created_by_id)
        creators = repo.users_by_ids(ts, list(uids))
        tokens = repo.tokens_top(ts, item.id, limit=30)
        can = {
            "edit_content": item.created_by_id == user.id,  # 内容＝作成者のみ（status 非依存）
            "curate": repo.is_curator(ts, user.id),          # 属性/triage/status/archive＝curator
            "add_link": True,                                # 関連リンク＝会社内 active 全員
        }
        return _detail_dto(item, categories=categories, links=links, title_map=title_map,
                           parent=parent, follow_ups=follow_ups, creators=creators, tokens=tokens, can=can)


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
