"""お知らせ（U・FR-49）のユースケース。閲覧＝全ユーザー／投稿・編集・削除＝管理者のみ（サーバー権威）。
本文は保存時 `app/core/richtext.sanitize_html` で無害化し平文を併置。通知（H）連携なし。"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone

from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.core.richtext import sanitize_html, to_plain_text
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.announcements import repository as repo
from app.tenant.announcements.orm import Announcement
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo

_EXCERPT = 120   # 一覧の抜粋文字数
_DASH_LIMIT = 3  # ダッシュボード Zone D の表示件数（§4.3a）


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _is_admin(account_id: uuid.UUID) -> bool:
    with control_session() as s:
        acc = s.get(Account, account_id)
    return acc is not None and acc.system_role in ("company_account_admin", "system_admin")


def _enc_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"off|{offset}".encode()).decode()


def _dec_cursor(cur: str | None) -> int:
    if not cur:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cur.encode()).decode()
        return int(raw.split("|", 1)[1]) if raw.startswith("off|") else 0
    except Exception:
        return 0


def pick_dashboard_announcements(items: list, *, limit: int = _DASH_LIMIT) -> list:
    """ダッシュボードパネルの選別（§4.3a・純関数）。入力＝表示対象を pinned→published_at 降順に並べた配列
    （各要素は `.pinned`/`.is_read` を持つ）。(1) ピン留めを最優先 → (2) 残り枠を未読で埋める →
    (3) 既読かつ非ピンは出さない。最大 `limit`。ピンが limit 超なら公開日時上位（入力順）で limit。"""
    pinned = [a for a in items if getattr(a, "pinned", False)]
    unread_unpinned = [a for a in items if not getattr(a, "pinned", False) and not getattr(a, "is_read", False)]
    out = pinned[:limit]
    for a in unread_unpinned:
        if len(out) >= limit:
            break
        out.append(a)
    return out


class _Row:
    """選別用の軽量ビュー（pinned/is_read を持つ）。"""
    __slots__ = ("a", "is_read")

    def __init__(self, a: Announcement, is_read: bool):
        self.a = a
        self.is_read = is_read

    @property
    def pinned(self) -> bool:
        return self.a.pinned


def _item_dict(a: Announcement, is_read: bool, read_at=None) -> dict:
    return {"id": str(a.id), "title": a.title, "excerpt": (a.body_text or "")[:_EXCERPT],
            "pinned": a.pinned, "published_at": a.published_at, "is_read": is_read, "read_at": read_at}


def list_announcements(account_id: uuid.UUID, company_id: uuid.UUID, *,
                       cursor: str | None = None, limit: int = 20, only_unread: bool = False) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    offset = _dec_cursor(cursor)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        # +1 件多く取り has_next 判定。未読絞りは read 集合で後段フィルタ（件数は小さい前提）。
        rows = repo.list_visible(ts, limit=limit + 1 + offset, offset=0)
        read_map = repo.read_map_for(ts, user.id, [a.id for a in rows])
        view = [(a, a.id in read_map, read_map.get(a.id)) for a in rows]
        if only_unread:
            view = [(a, r, rt) for (a, r, rt) in view if not r]
        page = view[offset:offset + limit]
        has_next = len(view) > offset + limit
        data = [_item_dict(a, r, rt) for (a, r, rt) in page]
        unread = repo.unread_count(ts, user.id)
    return {"data": data,
            "page_info": {"next_cursor": _enc_cursor(offset + limit) if has_next else None, "has_next": has_next},
            "unread_count": unread}


def get_announcement(account_id: uuid.UUID, company_id: uuid.UUID, announcement_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        a = repo.get_visible(ts, uuid.UUID(announcement_id))
        if a is None:
            raise AppError(404, "not_found")
        is_read = bool(repo.read_ids_for(ts, user.id, [a.id]))
        author = quests_repo.get_users_by_ids(ts, {a.created_by_id}).get(a.created_by_id)
        return {"id": str(a.id), "title": a.title, "body_html": a.body_html, "pinned": a.pinned,
                "published_at": a.published_at, "starts_at": a.starts_at, "ends_at": a.ends_at,
                "created_by": {"display_name": author.display_name if author else None}, "is_read": is_read}


def read_announcement(account_id: uuid.UUID, company_id: uuid.UUID, announcement_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        a = repo.get_visible(ts, uuid.UUID(announcement_id))
        if a is None:
            raise AppError(404, "not_found")
        repo.mark_read(ts, a.id, user.id)
        ts.commit()
    return {"is_read": True}


# ---- 管理（U.2・管理者のみ） ----

def _require_admin(account_id: uuid.UUID) -> None:
    if not _is_admin(account_id):
        raise AppError(403, "forbidden", detail="お知らせの管理は管理者のみ可能です")


def list_admin(account_id: uuid.UUID, company_id: uuid.UUID) -> dict:
    _require_admin(account_id)
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        rows = repo.list_all_admin(ts)
        data = [{"id": str(a.id), "title": a.title, "status": a.status, "pinned": a.pinned,
                 "published_at": a.published_at, "starts_at": a.starts_at, "ends_at": a.ends_at,
                 "read_count": repo.count_reads(ts, a.id)} for a in rows]
        return {"data": data, "can_manage": True}


def create_announcement(account_id: uuid.UUID, company_id: uuid.UUID, *, title: str, body_html: str,
                        status: str, pinned: bool, starts_at, ends_at) -> dict:
    _require_admin(account_id)
    if status not in ("draft", "published"):
        raise AppError(422, "validation_error", detail="status は draft/published のみ", errors=[{"field": "status"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    clean = sanitize_html(body_html)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        a = repo.create(ts, title=title.strip(), body_html=clean, body_text=to_plain_text(clean),
                        status=status, pinned=pinned, starts_at=starts_at, ends_at=ends_at,
                        published_at=datetime.now(timezone.utc) if status == "published" else None,
                        created_by_id=user.id)
        out = _admin_detail(a)
        ts.commit()
    return out


def update_announcement(account_id: uuid.UUID, company_id: uuid.UUID, announcement_id: str, patch: dict) -> dict:
    _require_admin(account_id)
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        a = repo.get(ts, uuid.UUID(announcement_id))
        if a is None:
            raise AppError(404, "not_found")
        if "title" in patch and patch["title"] is not None:
            a.title = patch["title"].strip()
        if "body_html" in patch and patch["body_html"] is not None:
            a.body_html = sanitize_html(patch["body_html"])
            a.body_text = to_plain_text(a.body_html)
        if "pinned" in patch and patch["pinned"] is not None:
            a.pinned = bool(patch["pinned"])
        for f in ("starts_at", "ends_at"):
            if f in patch:
                setattr(a, f, patch[f])
        if "status" in patch and patch["status"] is not None:
            new_status = patch["status"]
            if new_status not in ("draft", "published", "archived"):
                raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
            # draft→published で公開時刻を初期設定（既に設定済みなら維持）。
            if new_status == "published" and a.published_at is None:
                a.published_at = datetime.now(timezone.utc)
            a.status = new_status
        out = _admin_detail(a)
        ts.commit()
    return out


def delete_announcement(account_id: uuid.UUID, company_id: uuid.UUID, announcement_id: str) -> None:
    _require_admin(account_id)
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        a = repo.get(ts, uuid.UUID(announcement_id))
        if a is None:
            raise AppError(404, "not_found")
        user = profile_repo.get_user_by_account(ts, account_id)
        a.deleted_at = datetime.now(timezone.utc)
        a.deleted_by_id = user.id if user else None
        ts.commit()


def _admin_detail(a: Announcement) -> dict:
    return {"id": str(a.id), "title": a.title, "status": a.status, "pinned": a.pinned,
            "published_at": a.published_at, "starts_at": a.starts_at, "ends_at": a.ends_at, "read_count": 0}


# ---- ダッシュボード合成用（I.3 が呼ぶ・§4.3a／U.3） ----

def dashboard_panel(ts, user_id: uuid.UUID) -> dict:
    """ダッシュボード Zone D の お知らせパネル素材（最大3・§4.3a）＋未読数。I の読取合成から呼ぶ。"""
    rows = repo.list_visible(ts, limit=50, offset=0)  # 選別のため少し多めに取得（volume 小）
    read_ids = repo.read_ids_for(ts, user_id, [a.id for a in rows])
    views = [_Row(a, a.id in read_ids) for a in rows]
    picked = pick_dashboard_announcements(views, limit=_DASH_LIMIT)
    data = [_item_dict(v.a, v.is_read) for v in picked]
    return {"data": data, "unread_count": repo.unread_count(ts, user_id)}
