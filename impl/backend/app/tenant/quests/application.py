"""ドメイン C（クエスト）の application（imperative shell・API設計 C.1/C.4）。

会社DB を動的解決（§1.5・company_id はセッション由来）→ テナントユーザーを解決 →
可視性（グループ×パーティー門番は repository が per-quest 強制・C.0）を満たす一覧を DTO 化して返す。
本スライスは**読み取り経路（SC-10）**のみ＝`get_quests`／`get_quest_groups`。作成/編集は C.2 以降。
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.storage import get_storage
from app.tenant.profile import repository as profile_repo
from app.tenant.quest_group import repository as qg_repo
from app.tenant.quests import repository as repo

# 有効な quest_status（§3）。フィルタの想定外値は 422（§C.6 入力検証）。
_VALID_STATUS = {"draft", "recruiting", "in_progress", "evaluating", "completed"}

_EMPTY_PAGE = {"data": [], "page_info": {"next_cursor": None, "has_next": False}}


def _image_url(path: str | None) -> str | None:
    """MinIO キー→短TTL 署名URL（§1.10）。未設定は None（storage 未呼び出し）。"""
    return get_storage().presigned_get(path) if path else None


def _encode_cursor(quest) -> str:
    """(created_at, id) を不透明カーソルにエンコード（§1.8・me._encode_cursor と同方式）。"""
    raw = f"{quest.created_at.isoformat()}|{quest.id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        created_str, id_str = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created_str), uuid.UUID(id_str)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def get_quests(
    account_id: uuid.UUID,
    company_id: uuid.UUID,
    *,
    q: str | None = None,
    status: list[str] | None = None,
    group_id: str | None = None,
    limit: int,
    cursor: str | None = None,
) -> dict:
    """参加中クエスト＋自分の下書き一覧（SC-10・C.1・FR-15）。新着順・カーソル §1.8。

    参照制限（(A) 非draft×所属グループ×パーティー参加中 ／ (B) 自分の下書き）は repository が強制。
    会社/ユーザー未解決（通常起きない）は空ページ。
    """
    if status is not None:
        invalid = [s for s in status if s not in _VALID_STATUS]
        if invalid:
            raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
    group_uuid = _parse_uuid(group_id, field="group_id") if group_id else None
    cur = _decode_cursor(cursor) if cursor else None  # 不正カーソルは query 前に 422

    company = _resolve_company(company_id)
    if company is None:
        return _EMPTY_PAGE
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return _EMPTY_PAGE
        visible_group_ids = qg_repo.list_active_group_ids_for_user(ts, user.id)
        rows = repo.list_quests_for_user(
            ts, user_id=user.id, visible_group_ids=visible_group_ids,
            q=q, status=status, group_id=group_uuid, cursor=cur, limit=limit + 1,
        )
        has_next = len(rows) > limit
        rows = rows[:limit]
        # ページ分の付随情報を一括取得（N+1 回避）。
        owner_ids = list({r.owner_id for r in rows})
        gids = list({r.quest_group_id for r in rows})
        qids = [r.id for r in rows]
        owners, groups = repo.get_owners_and_groups(ts, owner_ids, gids)
        cats = repo.list_categories_for_quests(ts, qids)
        member_counts = repo.count_active_members_for_quests(ts, qids)
        data = [
            _quest_card_dto(r, user.id, owners, groups, cats, member_counts) for r in rows
        ]
    next_cursor = _encode_cursor(rows[-1]) if has_next and rows else None
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def get_quest_groups(account_id: uuid.UUID, company_id: uuid.UUID, *, q: str | None = None) -> dict:
    """自分が有効所属するグループ一覧（SC-10 フィルタ・SC-11 グループ選択・C.4）。"""
    company = _resolve_company(company_id)
    if company is None:
        return {"data": []}
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            return {"data": []}
        groups = repo.list_visible_groups(ts, user.id, q=q)
        data = [
            {"id": str(g.id), "quest_group_code": g.quest_group_code, "name": g.name} for g in groups
        ]
    return {"data": data}


def _quest_card_dto(quest, viewer_id, owners, groups, cats, member_counts) -> dict:
    owner = owners.get(quest.owner_id)
    group = groups.get(quest.quest_group_id)
    return {
        "id": str(quest.id),
        "title": quest.title,
        "color": quest.color,
        "icon_image_url": _image_url(quest.icon_image_path),
        "categories": [c.label for c in cats.get(quest.id, [])],
        "status": quest.status,
        "deadline": quest.deadline,
        "member_count": member_counts.get(quest.id, 0),
        # idea_count はドメイン D（ideas）実装後に接続。未実装のため 0。
        "idea_count": 0,
        "owner": {
            "user_id": str(quest.owner_id),
            "display_name": owner.display_name if owner else "",
            "avatar_image_url": _image_url(owner.avatar_image_path) if owner else None,
        },
        "quest_group": {
            "id": str(quest.quest_group_id),
            "quest_group_code": group.quest_group_code if group else "",
            "name": group.name if group else "",
        },
        # 本人の下書きは draft、それ以外は member。未投稿/投稿済みはドメイン D 実装後に精緻化（C.1）。
        "my_state": "draft" if quest.status == "draft" and quest.owner_id == viewer_id else "member",
    }


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])
