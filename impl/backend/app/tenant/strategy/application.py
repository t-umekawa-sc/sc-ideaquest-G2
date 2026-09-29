"""経営資料（strategy_documents）のユースケース（ドメイン R.1・管理者スコープ）。

認可は router の Depends(require_company_account_admin)＝会社アカウント管理者/system_admin（機微資料）。
選択用一覧のみ require_me（クエスト作成者が適用資料を選ぶ・R.0）。会社/ユーザーはセッション由来（§1.5）。
本文（構造化項目＋body_md 連結の body_text）を entity_tokens（owner_type='strategy_doc'）へ同期（整合率の素材）。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User
from app.tenant.strategy import repository as repo
from app.tenant.strategy.schemas import DOC_KINDS

_TEXT_FIELDS = ("intent", "policy_commitment", "strategy", "objectives", "body_md")


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _compose_body_text(doc) -> str:
    """構造化項目＋focus_areas＋body_md を連結した平文（トークン化/検索の素材・§5.54）。"""
    parts: list[str] = [getattr(doc, f) or "" for f in _TEXT_FIELDS]
    parts.append(" ".join(doc.focus_areas or []))
    return " ".join(p for p in parts if p).strip()


def _validate(*, doc_kind: str | None, status: str | None, period_from: date | None, period_to: date | None) -> None:
    errors = []
    if doc_kind is not None and doc_kind not in DOC_KINDS:
        errors.append({"field": "doc_kind", "code": "invalid_enum"})
    if status is not None and status not in ("active", "archived"):
        errors.append({"field": "status", "code": "invalid_enum"})
    if period_from and period_to and period_from > period_to:
        errors.append({"field": "period_to", "code": "invalid_range"})
    if errors:
        raise AppError(422, "validation_error", detail="入力内容を確認してください", errors=errors)


def _detail(ts, doc) -> dict:
    creator = ts.get(User, doc.created_by_id)
    return {
        "id": str(doc.id), "title": doc.title, "doc_kind": doc.doc_kind,
        "intent": doc.intent, "policy_commitment": doc.policy_commitment, "strategy": doc.strategy,
        "focus_areas": list(doc.focus_areas or []), "objectives": doc.objectives, "body_md": doc.body_md,
        "period_from": doc.period_from, "period_to": doc.period_to, "status": doc.status,
        "created_by": (creator.display_name if creator else None),
        "created_at": doc.created_at, "updated_at": doc.updated_at,
    }


def _persist_tokens(ts, doc) -> None:
    """本文を entity_tokens（owner_type='strategy_doc'）へ同期（整合率の永続トークン・§5.36b）。"""
    from app.tenant.info import application as info_app  # 遅延 import（derive+tokens_repo を再利用・DRY）
    info_app.persist_entity_tokens(ts, "strategy_doc", doc.id, doc.body_text)


def _list_item(doc) -> dict:
    return {
        "id": str(doc.id), "title": doc.title, "doc_kind": doc.doc_kind, "status": doc.status,
        "focus_areas": list(doc.focus_areas or []),
        "period_from": doc.period_from, "period_to": doc.period_to, "updated_at": doc.updated_at,
    }


# ---- 管理者 CRUD（R.1） ----

def create_document(account_id: uuid.UUID, company_id: uuid.UUID, *, body) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    _validate(doc_kind=body.doc_kind, status=None, period_from=body.period_from, period_to=body.period_to)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        doc = repo.create_document(
            ts, created_by_id=user.id, title=body.title.strip(), doc_kind=body.doc_kind,
            intent=body.intent, policy_commitment=body.policy_commitment, strategy=body.strategy,
            focus_areas=body.focus_areas or [], objectives=body.objectives, body_md=body.body_md,
            period_from=body.period_from, period_to=body.period_to, status="active",
        )
        doc.body_text = _compose_body_text(doc)
        ts.flush()
        _persist_tokens(ts, doc)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


def list_documents(account_id: uuid.UUID, company_id: uuid.UUID, *, q, status, doc_kind, sort, page, per_page) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    page = max(1, page or 1)
    per_page = min(100, max(1, per_page or 20))
    with get_tenant_session(company.db_identifier) as ts:
        rows, total = repo.list_documents(ts, q=q, status=status, doc_kind=doc_kind, sort=sort, page=page, per_page=per_page)
        return {
            "data": [_list_item(d) for d in rows],
            "page_info": {"page": page, "per_page": per_page, "total": total, "has_next": page * per_page < total},
        }


def get_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        return _detail(ts, doc)


def update_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str, *, body) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    data = body.model_dump(exclude_unset=True)
    _validate(doc_kind=data.get("doc_kind"), status=data.get("status"),
              period_from=data.get("period_from"), period_to=data.get("period_to"))
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        for field, value in data.items():
            setattr(doc, field, value)
        doc.body_text = _compose_body_text(doc)
        doc.updated_at = datetime.now(timezone.utc)
        ts.flush()
        _persist_tokens(ts, doc)  # 本文変更でトークン再永続化（整合率へ反映）
        payload = _detail(ts, doc)
        ts.commit()
    return payload


def archive_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        doc.status = "archived"
        doc.updated_at = datetime.now(timezone.utc)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


def unarchive_document(account_id: uuid.UUID, company_id: uuid.UUID, doc_id: str) -> dict:
    """アーカイブ解除（archived→active・R.1）＝クエストの選択候補に戻す（誤アーカイブの復元）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    did = _parse_uuid(doc_id)
    with get_tenant_session(company.db_identifier) as ts:
        doc = repo.get_document(ts, did)
        if doc is None:
            raise AppError(404, "not_found")
        doc.status = "active"
        doc.updated_at = datetime.now(timezone.utc)
        payload = _detail(ts, doc)
        ts.commit()
    return payload


# 物理削除は設けない（プロジェクト慣例＝基本は論理削除。経営資料は機微・監査保持のためアーカイブ＝§5.54/§R.1）。
# 使わなくする＝archive_document（status=archived）／戻す＝unarchive_document。


# ---- 選択用一覧（R.0・クエスト作成者） ----

def selection_list(account_id: uuid.UUID, company_id: uuid.UUID, *, q) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        rows = repo.selection_list(ts, q=q)
        return {"data": [
            {"id": str(d.id), "title": d.title, "doc_kind": d.doc_kind,
             "period_from": d.period_from, "period_to": d.period_to}
            for d in rows
        ]}


def _parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise AppError(404, "not_found")
