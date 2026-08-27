"""ドメイン G（ゲーミフィケーション）の application＝魔法カタログ/解放（SC-32・E.4 魔法の前提）。

魔法解放＝SP 消費（`ledger.grant(SP_SPEND)`・reason=spell_unlock）＋`user_spells` 追加を同一 UoW。
前提魔法（`requires_spell_id`）の解放済みチェック・SP 充足・二重解放防止（`UNIQUE(user_id, spell_id)`）。
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat import repository as chat_repo
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo

_JST = timezone(timedelta(hours=9))
_PERIODS = frozenset({"this_week", "last_week", "this_month", "all"})


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _image_url(path: str | None) -> str | None:
    from app.infra.storage import get_storage

    return get_storage().presigned_get(path) if path else None


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def list_spells(account_id, company_id) -> dict:
    """魔法カタログ＋解放状態（SC-32・E.4 ピッカー）。can_unlock＝前提解放済み＋未所有＋SP 充足。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        owned = chat_repo.list_user_spell_ids(ts, user.id)
        sp = user.skill_point_balance
        data = []
        for s in chat_repo.list_spells(ts):
            unlocked = s.id in owned
            prereq_ok = s.requires_spell_id is None or s.requires_spell_id in owned
            data.append({
                "id": str(s.id), "code": s.code, "name_ja": s.name_ja, "name_en": s.name_en,
                "icon": s.icon, "effect": s.effect, "sp_cost": s.sp_cost, "rarity": s.rarity, "line": s.line,
                "requires_spell_id": str(s.requires_spell_id) if s.requires_spell_id else None,
                "sort_order": s.sort_order,
                "unlocked": unlocked,
                "can_unlock": (not unlocked) and prereq_ok and sp >= s.sp_cost,
            })
        return {"data": data, "skill_point_balance": sp}


def unlock_spell(account_id, company_id, spell_id) -> dict:
    """魔法を解放（SC-32・SP 消費）。前提解放済み＋SP 充足＋未所有。二重解放は 409。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    sid = _parse_uuid(spell_id, field="spell_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        spell = chat_repo.get_spell(ts, sid)
        if spell is None:
            raise AppError(404, "not_found")
        if chat_repo.is_spell_unlocked(ts, user.id, sid):
            raise AppError(409, "conflict", detail="すでに解放済みです", extra={"errors": [{"reason": "already_unlocked"}]})
        if spell.requires_spell_id is not None and not chat_repo.is_spell_unlocked(ts, user.id, spell.requires_spell_id):
            raise AppError(409, "conflict", detail="前提の魔法を先に解放してください", extra={"errors": [{"reason": "prerequisite_not_met"}]})
        if user.skill_point_balance < spell.sp_cost:
            raise AppError(409, "conflict", detail="スキルポイントが不足しています", extra={"errors": [{"reason": "insufficient_sp"}]})
        ledger.grant(ts, user, kind=ledger.SP_SPEND, amount=spell.sp_cost, reason="spell_unlock",
                     ref_type="spells", ref_id=spell.id)
        chat_repo.add_user_spell(ts, user.id, spell.id)
        sp = user.skill_point_balance
        ts.commit()
    return {"spell_id": str(sid), "unlocked": True, "skill_point_balance": sp}


# ---- ランキング（G.5・§7） ----


def _period_bounds(period: str) -> tuple[datetime | None, datetime | None]:
    """期間の [start, end) を UTC で返す（週起点＝月曜00:00 JST・§7）。all は境界なし。"""
    now = datetime.now(timezone.utc)
    jst = now.astimezone(_JST)
    day0 = jst.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "this_week":
        start_jst = day0 - timedelta(days=day0.weekday())  # 月曜
        return start_jst.astimezone(timezone.utc), None
    if period == "last_week":
        this_mon = day0 - timedelta(days=day0.weekday())
        return (this_mon - timedelta(days=7)).astimezone(timezone.utc), this_mon.astimezone(timezone.utc)
    if period == "this_month":
        start_jst = day0.replace(day=1)
        return start_jst.astimezone(timezone.utc), None
    return None, None  # all


def get_rankings(account_id, company_id, *, period="this_week", scope="company", limit=20, cursor=None) -> dict:
    """期間スコア（獲得XP＋獲得コイン）ランキング（SC-41 全社／SC-12 クエスト内・G.5）。me を常時同梱。"""
    if period not in _PERIODS:
        raise AppError(422, "validation_error", detail="period が不正です", errors=[{"field": "period"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    offset = _decode_offset(cursor) if cursor else 0
    quest_id = None
    if scope and scope.startswith("quest:"):
        quest_id = _parse_uuid(scope.split(":", 1)[1], field="scope")
    elif scope not in (None, "", "company"):
        raise AppError(422, "validation_error", detail="scope が不正です", errors=[{"field": "scope"}])
    start, end = _period_bounds(period)
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if quest_id is not None and quests_repo.get_active_member(ts, quest_id, user.id) is None:
            raise AppError(404, "not_found")  # クエスト内は門番（C.0）
        rows = gami_repo.aggregate_ranking(ts, start=start, end=end, quest_id=quest_id)  # DB 側で順位確定済み（§7）
        total = len(rows)  # 軽量タプルのみ（DTO/署名URL は生成しない）
        # me＝順位/スコア（圏外でも同梱）。全行走査は軽量（DTO 化しない）。
        my_idx = next((i for i, r in enumerate(rows) if r[0] == user.id), None)
        my = rows[my_idx] if my_idx is not None else None
        me = {
            "rank": (my_idx + 1) if my_idx is not None else None,
            "score": (my[1] + my[2]) if my else 0,
            "xp": my[1] if my else 0,
            "coin": my[2] if my else 0,
            "total_users": total,
        }
        # DTO（氏名/アバター署名URL）解決はページ分のみ＝全ユーザー分の署名URL 生成を避ける（性能）。
        page_rows = rows[offset:offset + limit]
        users = quests_repo.get_users_by_ids(ts, {r[0] for r in page_rows})
        page = [
            {"rank": offset + i + 1, "user": _rank_user_dto(users.get(r[0]), r[0]),
             "score": r[1] + r[2], "xp": r[1], "coin": r[2]}
            for i, r in enumerate(page_rows)
        ]
        has_next = offset + limit < total
        next_cursor = _encode_offset(offset + limit) if has_next else None
    return {"data": page, "page_info": {"next_cursor": next_cursor, "has_next": has_next}, "me": me}


# --- アクティビティフィード（SC-12 クエスト内 / SC-01 チーム・G.5.1・活動＝activities の絞り込み） ---

_EMPTY_FEED = {"data": [], "page_info": {"next_cursor": None, "has_next": False}}


def _encode_feed_cursor(a) -> str:
    return base64.urlsafe_b64encode(f"{a.created_at.isoformat()}|{a.id}".encode()).decode()


def _decode_feed_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        created_str, id_str = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        return datetime.fromisoformat(created_str), uuid.UUID(id_str)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])


def _paginate(rows: list, limit: int) -> tuple[list, bool, str | None]:
    has_next = len(rows) > limit
    rows = rows[:limit]
    return rows, has_next, (_encode_feed_cursor(rows[-1]) if has_next and rows else None)


def _feed_row_dto(a, actor_user, quest_title: str | None = None) -> dict:
    row = {
        "id": str(a.id), "reason": a.reason, "kind": a.kind, "amount": a.amount,
        "ref_type": a.ref_type, "ref_id": str(a.ref_id) if a.ref_id else None,
        "quest_id": str(a.quest_id) if a.quest_id else None,
        "actor": _rank_user_dto(actor_user, a.user_id), "created_at": a.created_at,
    }
    if quest_title is not None:
        row["quest_title"] = quest_title
    return row


def get_quest_activities(account_id, company_id, quest_id, *, limit, cursor=None) -> dict:
    """クエスト内フィード（SC-12・G.5.1）＝当該クエストのメンバー活動（公開種別のみ・新しい順）。門番＝パーティー所属。"""
    qid = _parse_uuid(quest_id, field="quest_id")
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    cur = _decode_feed_cursor(cursor) if cursor else None  # 不正カーソルは query 前に 422
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if quests_repo.get_active_member(ts, qid, user.id) is None:
            raise AppError(404, "not_found")  # 門番＝パーティー所属（範囲外は存在秘匿）
        rows, has_next, next_cursor = _paginate(gami_repo.list_quest_feed(ts, qid, cursor=cur, limit=limit + 1), limit)
        actors = quests_repo.get_users_by_ids(ts, {a.user_id for a in rows})
        data = [_feed_row_dto(a, actors.get(a.user_id)) for a in rows]
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def get_team_feed(account_id, company_id, *, limit, cursor=None) -> dict:
    """チームフィード（SC-01・G.5.1）＝自分の参加クエスト横断のメンバー活動（公開種別のみ）。各行に quest を付す。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    cur = _decode_feed_cursor(cursor) if cursor else None
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        quest_ids = quests_repo.list_member_quest_ids(ts, user.id)
        if not quest_ids:
            return _EMPTY_FEED
        rows, has_next, next_cursor = _paginate(gami_repo.list_team_feed(ts, quest_ids, cursor=cur, limit=limit + 1), limit)
        actors = quests_repo.get_users_by_ids(ts, {a.user_id for a in rows})
        quest_map = quests_repo.get_quests_by_ids(ts, {a.quest_id for a in rows if a.quest_id})  # 一括（二重 get_quest 解消）
        data = [_feed_row_dto(a, actors.get(a.user_id),
                              quest_title=(quest_map[a.quest_id].title if a.quest_id in quest_map else "")) for a in rows]
    return {"data": data, "page_info": {"next_cursor": next_cursor, "has_next": has_next}}


def _rank_user_dto(u, user_id) -> dict:
    return {
        "id": str(user_id),
        "name": u.display_name if u else "",
        "avatar": _image_url(u.avatar_image_path) if u else None,
        "level": u.level if u else None,
    }


def _encode_offset(n: int) -> str:
    return base64.urlsafe_b64encode(f"off|{n}".encode()).decode()


def _decode_offset(cursor: str) -> int:
    try:
        prefix, n = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
        if prefix != "off":
            raise ValueError
        return max(0, int(n))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise AppError(422, "validation_error", detail="cursor が不正です", errors=[{"field": "cursor"}])
