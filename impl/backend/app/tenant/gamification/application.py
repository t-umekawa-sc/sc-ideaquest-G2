"""ドメイン G（ゲーミフィケーション）の application＝魔法カタログ/解放（SC-32・E.4 魔法の前提）。

魔法解放＝SP 消費（`ledger.grant(SP_SPEND)`・reason=spell_unlock）＋`user_spells` 追加を同一 UoW。
前提魔法（`requires_spell_id`）の解放済みチェック・SP 充足・二重解放防止（`UNIQUE(user_id, spell_id)`）。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat import repository as chat_repo
from app.tenant.gamification import ledger
from app.tenant.profile import repository as profile_repo


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


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
