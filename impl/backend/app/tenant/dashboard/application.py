"""ダッシュボード集約（ドメイン I・SC-01）＝各ドメインの read を1レスポンスに合成する「読取合成の殻」。

新業務ロジックは持たない（I.0）。リッチなパネル（週間ランキング/参加中クエスト/通知）は各ドメインの
**application** を再利用し、横断 read（下書き/未投票/フォロー中/下書き評価）は D/F の **repository** を呼ぶ（I.3）。
部分失敗は best-effort＝パネル単位で `None`（or 空）にし、全体は落とさない（I.4）。認証/テナント解決の失敗は 401。
"""
from __future__ import annotations

import logging
import uuid
from typing import Callable

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.infra.cache import get_redis
from app.infra.storage import get_storage
from app.tenant.dashboard import login_bonus
from app.tenant.evaluations import repository as evals_repo
from app.tenant.gamification import application as gami_app
from app.tenant.gamification.level import level_progress
from app.tenant.ideas import repository as ideas_repo
from app.tenant.notifications import application as notif_app
from app.tenant.profile import repository as profile_repo
from app.tenant.profile.orm import User
from app.tenant.quests import application as quests_app
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest

logger = logging.getLogger("app.dashboard")

_EVAL_ASPECTS_TOTAL = 5   # 評価観点数（novelty/impact/feasibility/fit/cost・F）
_UNVOTED_LIMIT = 6
_QUESTS_LIMIT = 6
_FOLLOWED_LIMIT = 6
_NOTIF_LIMIT = 5
_NON_DRAFT_STATUS = ["recruiting", "in_progress", "evaluating", "completed"]


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _safe(fn: Callable, *, default=None):
    """パネル1つの合成失敗で全体を落とさない（I.4）。失敗＝default を返しログ。"""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        logger.warning("dashboard panel failed", exc_info=True)
        return default


def _image_url(path: str | None) -> str | None:
    return get_storage().presigned_get(path) if path else None


def _poster(ts, user_id: uuid.UUID) -> dict:
    u = ts.get(User, user_id)
    return {"name": u.display_name if u else "（不明）",
            "avatar": _image_url(u.avatar_image_path) if u else None}


def _quest_ref(ts, quest_id: uuid.UUID, *, with_status: bool = False) -> dict:
    q = ts.get(Quest, quest_id)
    ref = {"id": str(quest_id), "title": q.title if q else "（削除されたクエスト）"}
    if with_status:
        ref["quest_status"] = q.status if q else None
    return ref


def _hero(ts, user: User) -> dict:
    prog = level_progress(user.xp)
    return {
        "id": str(user.id), "display_name": user.display_name, "locale": user.locale,
        "avatar_image_url": _image_url(user.avatar_image_path),
        "level": prog["level"], "xp": user.xp,
        "xp_to_next": prog["xp_to_next"], "level_span": prog["level_span"],
        "coin_balance": user.coin_balance, "skill_point_balance": user.skill_point_balance,
    }


def _drafts(ts, account_id: uuid.UUID, company_id: uuid.UUID, user: User) -> list[dict]:
    out: list[dict] = []
    # 下書きクエスト（本人のみ＝C の repo ルール B）。C の application を再利用。
    for card in quests_app.get_quests(account_id, company_id, status=["draft"], limit=50)["data"]:
        out.append({"kind": "quest", "quest_id": card["id"], "title": card["title"],
                    "categories": card.get("categories", []), "deadline": card.get("deadline")})
    # 下書きアイデア（全クエスト横断・I.3）。
    for idea in ideas_repo.list_draft_ideas_by_author(ts, user.id):
        out.append({"kind": "idea", "idea_id": str(idea.id), "title": idea.title,
                    "quest": _quest_ref(ts, idea.quest_id),
                    "updated_at": idea.updated_at.isoformat() if idea.updated_at else None})
    # 下書き評価（全アイデア横断・進捗 scored/5・I.3）。
    for ev in evals_repo.list_draft_evaluations_by_evaluator(ts, user.id):
        idea = ideas_repo.get_idea(ts, ev.idea_id)
        scored = len(evals_repo.list_scores(ts, ev.id))
        out.append({"kind": "evaluation",
                    "idea": {"id": str(ev.idea_id), "title": idea.title if idea else "（不明）"},
                    "quest": _quest_ref(ts, idea.quest_id) if idea else None,
                    "progress": {"scored": scored, "total": _EVAL_ASPECTS_TOTAL}})
    return out


def _vote_summary(ts, idea_id: uuid.UUID) -> dict:
    return ideas_repo.count_votes(ts, idea_id)


def _unvoted(ts, user: User) -> list[dict]:
    quest_ids = quests_repo.list_member_quest_ids(ts, user.id)
    ideas = ideas_repo.list_unvoted_published_ideas(ts, user.id, quest_ids, limit=_UNVOTED_LIMIT)
    return [{
        "id": str(i.id), "title": i.title, "quest": _quest_ref(ts, i.quest_id),
        "poster": _poster(ts, i.author_id), "value": i.value,
        "vote_summary": _vote_summary(ts, i.id),
        "deadline": i.time_limit.isoformat() if i.time_limit else None,
    } for i in ideas]


def _followed(ts, user: User) -> list[dict]:
    ideas = ideas_repo.list_followed_ideas(ts, user.id, limit=_FOLLOWED_LIMIT)
    return [{
        "id": str(i.id), "title": i.title, "quest": _quest_ref(ts, i.quest_id, with_status=True),
        "poster": _poster(ts, i.author_id), "value": i.value,
        "vote_summary": _vote_summary(ts, i.id),
        "updated_at": i.updated_at.isoformat() if i.updated_at else None, "following": True,
    } for i in ideas]


def get_dashboard(session: dict) -> dict:
    """SC-01 の全パネルを1レスポンスに集約（I.1）。session＝require_me の戻り（account/company/role/user）。"""
    account_id = uuid.UUID(session["account_id"])
    company_id = uuid.UUID(session["company_id"])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        hero = _safe(lambda: _hero(ts, user))
        drafts = _safe(lambda: _drafts(ts, account_id, company_id, user), default=[])
        unvoted = _safe(lambda: _unvoted(ts, user), default=[])
        followed = _safe(lambda: _followed(ts, user), default=[])

    # リッチパネルは各ドメイン application を再利用（自前セッション・best-effort）。
    quests = _safe(
        lambda: quests_app.get_quests(account_id, company_id, status=_NON_DRAFT_STATUS,
                                      limit=_QUESTS_LIMIT)["data"], default=[])
    weekly_ranking = _safe(lambda: gami_app.get_rankings(
        account_id, company_id, period="this_week", scope="company", limit=3))
    notifications = _safe(lambda: notif_app.get_notifications(
        account_id, company_id, limit=_NOTIF_LIMIT))
    roles = {
        "is_qg_admin": bool(session.get("is_qg_admin")),
        "is_company_account_admin": session.get("system_role") == "company_account_admin",
        "is_system_admin": session.get("system_role") == "system_admin",
    }
    bonus = login_bonus.consume(get_redis(), session["user"]["user_id"]) \
        if session.get("user", {}).get("user_id") else None

    return {
        "hero": hero, "drafts": drafts, "unvoted_ideas": unvoted, "quests": quests,
        "followed_ideas": followed, "weekly_ranking": weekly_ranking,
        "notifications": notifications, "roles": roles, "login_bonus": bonus,
    }
