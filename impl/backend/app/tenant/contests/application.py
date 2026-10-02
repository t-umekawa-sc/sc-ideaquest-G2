"""アイデアコンテストのユースケース（FR-46・API設計 T.1）。

**アーキの芯＝クエストを器に再利用**＝コンテスト作成時に backing quest を 1:1 で生成し、アイデア/投票/評価/
チャット/ランキングは既存機構を無改修で共有。本層はコンテスト固有（枠CRUD・会期状態機械）を担う。
作成/編集は②能力 `contest_create`（または管理者）＝偏り防止と運営統制（§5.3・決定I）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.control_plane.auth.orm import Account, Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.capabilities import application as caps_app
from app.tenant.contests import repository as repo
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest

# コンテスト状態機械（設計 §4.1）と backing quest.status へのマップ。
_CONTEST_STATUS = ("draft", "open", "judging", "closed", "archived")
_CONTEST_FLOW = {"draft": {"open"}, "open": {"judging"}, "judging": {"closed"},
                 "closed": {"archived"}, "archived": set()}
_QUEST_STATUS = {"draft": "draft", "open": "recruiting", "judging": "evaluating",
                 "closed": "completed", "archived": "completed"}
_MODES = ("bounded", "rolling")


def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _is_company_admin(account_id: uuid.UUID) -> bool:
    with control_session() as s:
        acc = s.get(Account, account_id)
    return acc is not None and acc.system_role in ("company_account_admin", "system_admin")


def _can_create_contest(account_id: uuid.UUID, ts, user_id: uuid.UUID) -> bool:
    """コンテスト作成/編集可否（決定I）＝管理者 OR ②能力 `contest_create` 保持者。"""
    return _is_company_admin(account_id) or caps_app.user_has_capability(ts, user_id, "contest_create")


def _detail(c, *, idea_count: int = 0) -> dict:
    return {
        "id": str(c.id), "quest_id": str(c.quest_id), "mode": c.mode, "status": c.status,
        "theme": c.theme, "description": c.description,
        "starts_at": c.starts_at, "ends_at": c.ends_at,
        "auto_archive_days": c.auto_archive_days, "prize_config": c.prize_config,
        "created_at": c.created_at, "idea_count": idea_count,
    }


def _list_item(c) -> dict:
    return {
        "id": str(c.id), "mode": c.mode, "status": c.status, "theme": c.theme,
        "starts_at": c.starts_at, "ends_at": c.ends_at, "created_at": c.created_at,
    }


def create_contest(account_id: uuid.UUID, company_id: uuid.UUID, *, theme: str, description: str | None,
                   mode: str, status: str, starts_at, ends_at, auto_archive_days: int | None,
                   prize_config: dict | None) -> dict:
    """コンテスト作成＝backing quest を 1:1 生成＋contests 行。要 `contest_create`（または管理者）。"""
    if mode not in _MODES:
        raise AppError(422, "validation_error", detail="mode が不正です", errors=[{"field": "mode"}])
    if status not in ("draft", "open"):  # 作成時は draft か即 open のみ（以降は PATCH で前進）
        raise AppError(422, "validation_error", detail="作成時の status は draft/open のみ",
                       errors=[{"field": "status"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        if not _can_create_contest(account_id, ts, user.id):
            raise AppError(403, "forbidden", detail="コンテストを作成する権限がありません",
                           extra={"errors": [{"code": "capability_required", "capability": "contest_create"}]})
        # backing quest（器）＝作成者=owner・title=テーマ・status はコンテスト状態にマップ（§4.1）。
        quest = quests_repo.create_quest(ts, owner_id=user.id, title=theme, color=company.color or "#6366F1",
                                         status=_QUEST_STATUS[status])
        ts.flush()
        c = repo.create(ts, quest_id=quest.id, theme=theme, description=description, mode=mode,
                        status=status, starts_at=starts_at, ends_at=ends_at,
                        auto_archive_days=auto_archive_days, prize_config=prize_config,
                        created_by_id=user.id)
        out = _detail(c)
        ts.commit()
    return out


def list_contests(account_id: uuid.UUID, company_id: uuid.UUID, *, status: str | None = None) -> dict:
    """一覧（会社内 read・会期タブ絞り込み）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        rows = repo.list_all(ts, status=status)
        return {"data": [_list_item(c) for c in rows]}


def get_contest(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str) -> dict:
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        return _detail(c)


def update_contest(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str, *,
                   fields: dict, status: str | None) -> dict:
    """会期/テーマ/賞の編集＋状態遷移（前進のみ）。要 `contest_create`（または管理者）。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        if not _can_create_contest(account_id, ts, user.id):
            raise AppError(403, "forbidden", detail="コンテストを編集する権限がありません")
        # 状態遷移＝前進のみ（設計 §4.1）。backing quest.status も同期。
        if status is not None and status != c.status:
            if status not in _CONTEST_STATUS or status not in _CONTEST_FLOW.get(c.status, set()):
                raise AppError(409, "conflict", detail="不正な状態遷移です",
                               extra={"errors": [{"reason": "invalid_state"}]})
            c.status = status
            quest = ts.get(Quest, c.quest_id)
            if quest is not None:
                quest.status = _QUEST_STATUS[status]
        # フィールド編集（送られたもののみ）。
        for key in ("theme", "description", "starts_at", "ends_at", "auto_archive_days", "prize_config"):
            if key in fields:
                setattr(c, key, fields[key])
        c.updated_at = datetime.now(timezone.utc)
        out = _detail(c)
        ts.commit()
    return out


# ---- 参加 2階層（T.2・§5.1） ----

def request_contest_participation(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str) -> dict:
    """Tier1 参加リクエスト（本人）。public/DEMO は自動 `approved`（決定G）、それ以外は `requested`。"""
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        auto = company.access_mode == "public"  # DEMO はサインアップ即参加（閲覧+投稿+投票）
        row = repo.upsert_contest_participation(ts, c.id, user.id,
                                                status="approved" if auto else "requested",
                                                decided_by_id=user.id if auto else None)
        out = {"status": row.status}
        ts.commit()
    return out


def decide_contest_participation(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str,
                                 target_user_id: str, status: str) -> dict:
    """Tier1 承認/却下（管理者）。"""
    if status not in ("approved", "rejected"):
        raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        if not _is_company_admin(account_id):
            raise AppError(403, "forbidden", detail="Tier1 参加の承認は管理者のみです")
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        row = repo.upsert_contest_participation(ts, c.id, uuid.UUID(target_user_id),
                                                status=status, decided_by_id=actor.id)
        out = {"status": row.status}
        ts.commit()
    return out


def request_idea_participation(account_id: uuid.UUID, company_id: uuid.UUID, idea_id: str) -> dict:
    """Tier2 参加リクエスト（本人・チャット希望）。コンテスト配下アイデアのみ。"""
    from app.tenant.ideas import repository as ideas_repo
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        user = profile_repo.get_user_by_account(ts, account_id)
        if user is None:
            raise AppError(401, "unauthenticated")
        idea = ideas_repo.get_idea(ts, uuid.UUID(idea_id))
        if idea is None:
            raise AppError(404, "not_found")
        if repo.contest_by_quest(ts, idea.quest_id) is None:
            raise AppError(422, "validation_error", detail="コンテストのアイデアではありません",
                           errors=[{"field": "idea_id"}])
        row = repo.upsert_idea_participation(ts, idea.id, user.id, status="requested")
        out = {"status": row.status}
        ts.commit()
    return out


def decide_idea_participation(account_id: uuid.UUID, company_id: uuid.UUID, idea_id: str,
                              target_user_id: str, status: str) -> dict:
    """Tier2 承認/却下＝**そのアイデアの投稿者のみ**（荒れ対策・心理的安全性）。"""
    from app.tenant.ideas import repository as ideas_repo
    if status not in ("approved", "rejected"):
        raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        idea = ideas_repo.get_idea(ts, uuid.UUID(idea_id))
        if idea is None:
            raise AppError(404, "not_found")
        if idea.author_id != actor.id:
            raise AppError(403, "forbidden", detail="このアイデアの参加承認は投稿者のみ可能です")
        row = repo.upsert_idea_participation(ts, idea.id, uuid.UUID(target_user_id),
                                             status=status, decided_by_id=actor.id)
        out = {"status": row.status}
        ts.commit()
    return out
