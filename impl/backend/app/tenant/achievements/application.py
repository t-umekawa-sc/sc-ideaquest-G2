"""ドメイン G（実績）の application（G.4）＝一覧/自分の獲得。付与は engine（台帳フック）が一元化。

GET は読み取り専用。進捗は user_achievements があればそれ、無ければ engine.compute で読み取り算出（書き込まない）。
シークレット未獲得はサーバーで伏せる（名称/説明/条件/報酬/ティア/アイコン非開示・G.4）。
"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.achievements import engine
from app.tenant.achievements import repository as repo
from app.tenant.profile import repository as profile_repo


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def get_achievements(account_id, company_id, *, category=None, state="all") -> dict:
    """実績マスタ＋自分の獲得/進捗（SC-40・G.4）。category/state で絞り込み・summary 同梱。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    if state not in ("all", "unlocked", "locked"):
        raise AppError(422, "validation_error", detail="state が不正です", errors=[{"field": "state"}])
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        owned = repo.list_user_achievements(ts, user.id)
        data = []
        unlocked_n = 0
        coin_earned = 0
        for ach in repo.list_achievements(ts):
            ua = owned.get(ach.id)
            unlocked = ua is not None and ua.unlocked_at is not None
            if unlocked:
                unlocked_n += 1
                coin_earned += ach.coin_reward
            if category and ach.category != category:
                continue
            if state == "unlocked" and not unlocked:
                continue
            if state == "locked" and unlocked:
                continue
            if ach.is_secret and not unlocked:
                data.append({"id": str(ach.id), "is_secret": True, "unlocked": False, "tier": None,
                             "name": "？？？", "description": "？？？", "category": ach.category,
                             "icon": "？", "condition_label": "？？？", "coin_reward": 0,
                             "progress": {"current": 0, "target": None}})
                continue
            if ua is not None:
                cur, target = ua.progress_current, ua.progress_target
            else:
                cur, target, _ = engine.compute(ts, user, ach)  # 未評価は読み取り算出
            data.append({
                "id": str(ach.id), "code": ach.code, "category": ach.category, "tier": ach.tier,
                "icon": ach.icon, "name": ach.name_ja, "description": ach.description_ja,
                "condition_label": ach.description_ja, "coin_reward": ach.coin_reward,
                "is_secret": ach.is_secret, "unlocked": unlocked,
                "unlocked_at": ua.unlocked_at if ua else None,
                "progress": {"current": cur, "target": target},
            })
        total = len(repo.list_achievements(ts))
        return {"data": data, "summary": {"unlocked": unlocked_n, "total": total, "coin_earned": coin_earned}}


def get_my_achievements(account_id, company_id) -> dict:
    """自分の獲得実績（獲得日・進捗・G.4）。user_achievements 行のみ。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        by_id = {a.id: a for a in repo.list_achievements(ts)}
        data = []
        for aid, ua in repo.list_user_achievements(ts, user.id).items():
            ach = by_id.get(aid)
            data.append({
                "achievement_id": str(aid), "code": ach.code if ach else "", "tier": ach.tier if ach else "",
                "unlocked_at": ua.unlocked_at, "progress_current": ua.progress_current, "progress_target": ua.progress_target,
            })
        return {"data": data}
