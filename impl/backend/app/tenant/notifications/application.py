"""ドメイン H（通知）の application（H.2/H.3）＝取得/未読数/既読・未読・全既読。

すべて自分宛スコープ（recipient_id＝セッションユーザー・IDOR 対策・H.4）。本文は取得時レンダリング（catalog・§8-⑳）。
一覧はカーソル（§1.8・新着降順）。既読/未読は表示状態のみ反転（遷移しない）。
"""
from __future__ import annotations

import base64
import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.notifications import catalog
from app.tenant.notifications import repository as repo
from app.tenant.notifications import service
from app.tenant.profile import repository as profile_repo
from app.tenant.notifications.service import TYPE_PRIORITY

_VALID_TYPES = set(TYPE_PRIORITY.keys())


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _encode_cursor(n) -> str:
    return base64.urlsafe_b64encode(f"{n.created_at.isoformat()}|{n.id}".encode()).decode()


def _decode_cursor(cursor: str):
    try:
        from datetime import datetime
        created, nid = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created), uuid.UUID(nid)
    except Exception:  # noqa: BLE001
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


def _parse_types(type_param) -> list[str] | None:
    """`type` クエリ（反復 or CSV）を notification_type 列に整形。不正値は 422。"""
    if not type_param:
        return None
    raw: list[str] = []
    for v in type_param if isinstance(type_param, list) else [type_param]:
        raw.extend(part.strip() for part in str(v).split(",") if part.strip())
    for t in raw:
        if t not in _VALID_TYPES:
            raise AppError(422, "validation_error", detail="type が不正です", errors=[{"field": "type"}])
    return raw or None


def _dto(ts, n) -> dict:
    r = catalog.render(ts, n)
    return {
        "id": str(n.id), "type": n.type, "body": r["body"], "context": r["context"],
        "icon": r["icon"], "tag": r["tag"],
        "ref": {
            "idea_id": str(n.ref_idea_id) if n.ref_idea_id else None,
            "chat_message_id": str(n.ref_chat_message_id) if n.ref_chat_message_id else None,
            "idea_revision_id": str(n.ref_idea_revision_id) if n.ref_idea_revision_id else None,
            "achievement_id": str(n.ref_achievement_id) if n.ref_achievement_id else None,
            "quest_id": str(n.ref_quest_id) if n.ref_quest_id else None,
        },
        "is_read": n.is_read, "created_at": n.created_at,
        "meta": r["meta"],
    }


def _company_and_user(account_id, company_id):
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    return company


def get_notifications(account_id, company_id, *, state="all", type_param=None, limit=30, cursor=None) -> dict:
    """自分宛の通知一覧（SC-02・H.2）＋未読数。"""
    if state not in ("all", "unread"):
        raise AppError(422, "validation_error", detail="state が不正です", errors=[{"field": "state"}])
    types = _parse_types(type_param)
    limit = max(1, min(int(limit), 100))
    before = _decode_cursor(cursor) if cursor else None
    company = _company_and_user(account_id, company_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        rows, has_more = repo.list_for_recipient(ts, user.id, state=state, types=types, before=before, limit=limit)
        data = [_dto(ts, n) for n in rows]
        unread = repo.unread_count(ts, user.id)
        next_cursor = _encode_cursor(rows[-1]) if (has_more and rows) else None
        return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_more}, "unread_count": unread}


def get_unread_count(account_id, company_id) -> dict:
    """未読数のみ（ヘッダーベル・軽量・H.2）。"""
    company = _company_and_user(account_id, company_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        return {"unread_count": repo.unread_count(ts, user.id)}


def _set_read(account_id, company_id, notif_id, is_read: bool) -> dict:
    try:
        nid = uuid.UUID(notif_id)
    except (ValueError, AttributeError):
        raise AppError(404, "not_found")
    company = _company_and_user(account_id, company_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        n = repo.get_for_recipient(ts, nid, user.id)
        if n is None:
            raise AppError(404, "not_found")  # 他人宛は存在秘匿（IDOR・H.4）
        n.is_read = is_read  # 冪等（既に同状態でも no-op で 200）
        unread = repo.unread_count(ts, user.id)
        service.publish_unread_count(ts, user.id, unread)  # ベル同期（post-commit・L.3）
        ts.commit()
        return {"id": str(n.id), "is_read": is_read, "unread_count": unread}


def mark_read(account_id, company_id, notif_id) -> dict:
    return _set_read(account_id, company_id, notif_id, True)


def mark_unread(account_id, company_id, notif_id) -> dict:
    return _set_read(account_id, company_id, notif_id, False)


def mark_all_read(account_id, company_id, *, type_param=None) -> dict:
    """すべて既読化（type 絞り込み可・H.3）。"""
    types = _parse_types(type_param)
    company = _company_and_user(account_id, company_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        updated = repo.mark_all_read(ts, user.id, types=types)
        unread = repo.unread_count(ts, user.id)
        service.publish_unread_count(ts, user.id, unread)  # ベル同期（post-commit・L.3）
        ts.commit()
        return {"updated": updated, "unread_count": unread}
