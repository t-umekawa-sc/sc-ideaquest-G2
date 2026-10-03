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
# 隣接1段の**前進・後退とも可**（運営がやり直せるように・クエストの status 遷移と同方針）。
# 後退で closed→judging に戻しても、確定済みの表彰（contest_award ledger/実績）は取り消さない（冪等・監査保持）。
_CONTEST_STATUS = ("draft", "open", "judging", "closed", "archived")
_CONTEST_FLOW = {
    "draft": {"open"},
    "open": {"draft", "judging"},
    "judging": {"open", "closed"},
    "closed": {"judging", "archived"},
    "archived": {"closed"},
}
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


def _detail(c, *, idea_count: int = 0, flags: list | None = None,
            my_participating_idea_ids: list | None = None, can_manage: bool = False,
            owner_display_name: str | None = None) -> dict:
    return {
        "id": str(c.id), "quest_id": str(c.quest_id), "mode": c.mode, "status": c.status,
        "theme": c.theme, "description": c.description,
        "starts_at": c.starts_at, "ends_at": c.ends_at,
        "auto_archive_days": c.auto_archive_days, "auto_approve": c.auto_approve,
        "prize_config": c.prize_config,
        "created_at": c.created_at, "idea_count": idea_count, "flags": flags or [],
        "my_participating_idea_ids": my_participating_idea_ids or [], "can_manage": can_manage,
        "owner_user_id": str(c.created_by_id), "owner_display_name": owner_display_name,
    }


def _list_item(c) -> dict:
    return {
        "id": str(c.id), "mode": c.mode, "status": c.status, "theme": c.theme,
        "starts_at": c.starts_at, "ends_at": c.ends_at, "created_at": c.created_at,
    }


def create_contest(account_id: uuid.UUID, company_id: uuid.UUID, *, theme: str, description: str | None,
                   mode: str, status: str, starts_at, ends_at, auto_archive_days: int | None,
                   prize_config: dict | None, auto_approve: bool = False) -> dict:
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
                        created_by_id=user.id, auto_approve=auto_approve)
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
        flags = [{"idea_id": str(f.idea_id), "flag": f.flag} for f in repo.list_flags_for_contest(ts, c.id)]
        user = profile_repo.get_user_by_account(ts, account_id)
        mine = ([str(i) for i in repo.discussion_idea_ids(ts, c.quest_id, user.id)] if user else [])
        can_manage = bool(user and _can_create_contest(account_id, ts, user.id))
        owner = quests_repo.get_users_by_ids(ts, {c.created_by_id}).get(c.created_by_id)
        return _detail(c, flags=flags, my_participating_idea_ids=mine, can_manage=can_manage,
                       owner_display_name=(owner.display_name if owner else None))


def list_participants(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str) -> dict:
    """Tier1 参加者一覧（パーティタブ・運営のみ＝contest_create/管理者）。承認待ちを先頭に。"""
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
            raise AppError(403, "forbidden", detail="参加者の管理は運営（contest_create/管理者）のみ可能です")
        from app.tenant.capabilities import repository as caps_repo
        rows = repo.list_contest_participants(ts, c.id)
        users = quests_repo.get_users_by_ids(ts, {r.user_id for r in rows})
        data = [{"user_id": str(r.user_id),
                 "display_name": (users.get(r.user_id).display_name if users.get(r.user_id) else None),
                 "status": r.status,
                 "is_evaluator": caps_repo.has_capability(ts, r.user_id, "contest_evaluator"),
                 "requested_at": r.requested_at, "decided_at": r.decided_at}
                for r in rows]
        return {"data": data}


def participant_candidates(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str,
                           q: str | None = None, cursor: str | None = None) -> dict:
    """パーティ追加の候補＝会社の有効ユーザー（既参加〔approved/requested〕・主催者は除外）。運営のみ・カーソルページング。

    会社全体スコープ＝`list_cross_group_candidates(group_ids=[])`（部署絞りなし）を流用（FR-38 候補基盤）。
    「もっと見る」＝keyset カーソル（display_name,id の昇順）。
    """
    import base64
    _LIMIT = 20

    def _dec(cur: str):
        try:
            name, sid = base64.urlsafe_b64decode(cur.encode()).decode().split("\x1f", 1)
            return (name, uuid.UUID(sid))
        except Exception:
            return None

    def _enc(u) -> str:
        return base64.urlsafe_b64encode(f"{u.display_name}\x1f{u.id}".encode()).decode()

    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        if not _can_create_contest(account_id, ts, actor.id):
            raise AppError(403, "forbidden", detail="参加者の追加は運営（contest_create/管理者）のみ可能です")
        # 既参加（approved/requested）＋主催者は候補から除外。
        exclude = {c.created_by_id}
        for p in repo.list_contest_participants(ts, c.id):
            if p.status in ("approved", "requested"):
                exclude.add(p.user_id)
        rows = quests_repo.list_cross_group_candidates(
            ts, [], q=q, exclude_user_ids=list(exclude),
            cursor=(_dec(cursor) if cursor else None), limit=_LIMIT + 1)
        has_next = len(rows) > _LIMIT
        rows = rows[:_LIMIT]
        next_cursor = _enc(rows[-1]) if (has_next and rows) else None
        return {"data": [{"user_id": str(u.id), "display_name": u.display_name} for u in rows],
                "next_cursor": next_cursor, "has_next": has_next}


def set_idea_status(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str,
                    idea_id: str, flag: str, on: bool) -> dict:
    """アイデアの入賞/殿堂入り/お蔵入りを運営が手動で設定（SC-54 アイデアタブの動線・運営のみ）。

    flag＝`selected`（ideas.is_selected）／`hall_of_fame`・`shelved`（contest_idea_flags）。
    """
    from app.tenant.ideas import repository as ideas_repo
    if flag not in ("selected", "hall_of_fame", "shelved"):
        raise AppError(422, "validation_error", detail="flag が不正です", errors=[{"field": "flag"}])
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        if not _can_create_contest(account_id, ts, actor.id):
            raise AppError(403, "forbidden", detail="入賞/殿堂入り/お蔵入りの設定は運営（contest_create/管理者）のみ可能です")
        idea = ideas_repo.get_idea(ts, uuid.UUID(idea_id))
        if idea is None or idea.quest_id != c.quest_id:
            raise AppError(404, "not_found")  # このコンテストのアイデアではない
        # 入賞/殿堂入り/お蔵入りは**排他**（1アイデアは1状態）＝ON にしたら他を解除。OFF は当該だけ解除（＝応募中へ戻る）。
        if on:
            idea.is_selected = (flag == "selected")
            for other in ("hall_of_fame", "shelved"):
                if other != flag:
                    repo.remove_idea_flag(ts, idea.id, other)
            if flag in ("hall_of_fame", "shelved"):
                repo.set_idea_flag(ts, contest_id=c.id, idea_id=idea.id, flag=flag, granted_by_id=actor.id)
        else:
            if flag == "selected":
                idea.is_selected = False
            else:
                repo.remove_idea_flag(ts, idea.id, flag)
        ts.commit()
    return {"flag": flag, "on": on}


def set_participant_evaluator(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str,
                             target_user_id: str, granted: bool) -> dict:
    """参加者に審査員（contest_evaluator・②会社レベル能力）を付与/剥奪（パーティタブ・運営のみ）。

    contest_evaluator は会社横断の能力（§5.3・決定J'）＝付与するとその人は全コンテストの審査員になる。
    """
    from app.tenant.capabilities import repository as caps_repo
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    with get_tenant_session(company.db_identifier) as ts:
        actor = profile_repo.get_user_by_account(ts, account_id)
        if actor is None:
            raise AppError(401, "unauthenticated")
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        if not _can_create_contest(account_id, ts, actor.id):
            raise AppError(403, "forbidden", detail="審査員の設定は運営（contest_create/管理者）のみ可能です")
        uid = uuid.UUID(target_user_id)
        if granted:
            caps_repo.grant(ts, uid, "contest_evaluator", granted_by_id=actor.id)
        else:
            caps_repo.revoke(ts, uid, "contest_evaluator")
        ts.commit()
    return {"granted": granted}


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
        for key in ("theme", "description", "starts_at", "ends_at", "auto_archive_days", "auto_approve", "prize_config"):
            if key in fields:
                setattr(c, key, fields[key])
        c.updated_at = datetime.now(timezone.utc)
        out = _detail(c)
        ts.commit()
    return out


def delete_contest(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str) -> None:
    """コンテストを論理削除（T.1）＝contests.deleted_at＋backing quest.deleted_at。要 `contest_create`（または管理者）。

    子データ（アイデア/投票/評価/チャット）は監査のため保持（quests 削除と同方針）。一覧/詳細から見えなくなる。
    """
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
            raise AppError(403, "forbidden", detail="コンテストを削除する権限がありません")
        now = datetime.now(timezone.utc)
        c.deleted_at = now
        quest = ts.get(Quest, c.quest_id)
        if quest is not None:
            quest.deleted_at = now
        ts.commit()


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
        # public/DEMO は常に自動承認（決定G）／社内はコンテスト単位の auto_approve で選べる（既定=承認制）。
        auto = company.access_mode == "public" or bool(c.auto_approve)
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
        c = repo.get(ts, uuid.UUID(contest_id))
        if c is None:
            raise AppError(404, "not_found")
        if not _can_create_contest(account_id, ts, actor.id):
            raise AppError(403, "forbidden", detail="Tier1 参加の承認/排除は運営（contest_create/管理者）のみです")
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


# ---- 表彰・ランキング（T.3/T.1 finalize・設計 §6・既存基盤の再利用） ----

_AXES = ("approve_votes", "avg_score", "contribution")
# 順位→入賞バッジのティア（1位=gold/2位=silver/3位=bronze・軸横断で再利用・migration 0052）。
_TIER_BY_RANK = {0: "gold", 1: "silver", 2: "bronze"}


def _name_of(users: dict, uid) -> str | None:
    u = users.get(uid)
    return u.display_name if u is not None else None


def ranking(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str, *, axis: str) -> dict:
    """会期スコープのランキング（T.3・§6.1）＝賛成投票数/平均評価点/活動貢献。backing quest×[starts_at,ends_at)。"""
    if axis not in _AXES:
        raise AppError(422, "validation_error", detail="axis が不正です", errors=[{"field": "axis"}])
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
        start, end = c.starts_at, c.ends_at
        data: list[dict] = []
        if axis == "contribution":
            rows = repo.rank_contribution(ts, c.quest_id, start=start, end=end)
            users = quests_repo.get_users_by_ids(ts, {uid for uid, _ in rows})
            data = [{"rank": i + 1, "user_id": str(uid), "display_name": _name_of(users, uid),
                     "idea_id": None, "metric": float(n)} for i, (uid, n) in enumerate(rows)]
        else:
            rows = (repo.rank_approve_votes(ts, c.quest_id, start=start, end=end) if axis == "approve_votes"
                    else repo.rank_avg_score(ts, c.quest_id, start=start, end=end))
            users = quests_repo.get_users_by_ids(ts, {aid for _, aid, _ in rows})
            data = [{"rank": i + 1, "user_id": str(aid), "display_name": _name_of(users, aid),
                     "idea_id": str(iid), "metric": float(m)} for i, (iid, aid, m) in enumerate(rows)]
        return {"axis": axis, "data": data}


def finalize(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str) -> dict:
    """表彰確定（T.1・§6.2・冪等）＝各軸上位N へ XP/コイン付与＋入賞バッジ＋is_selected＋殿堂入り＋通知。

    状態＝`judging`→`closed`。付与は `ledger.grant`（reason='contest_award'・ref=(contests, id)）＝ユーザー単位で
    XP/コインを1回ずつ（軸横断で合算）＝再実行しても `grant_exists_by_ref` で二重付与しない（§1.9）。
    """
    from app.tenant.achievements import engine as ach_engine
    from app.tenant.achievements import repository as ach_repo
    from app.tenant.gamification import ledger
    from app.tenant.gamification import repository as gami_repo
    from app.tenant.ideas import repository as ideas_repo

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
            raise AppError(403, "forbidden", detail="表彰を確定する権限がありません")
        if c.status not in ("judging", "closed"):  # judging で確定／closed は冪等再実行（no-op）
            raise AppError(409, "conflict", detail="表彰確定は審査中（judging）に実行してください",
                           extra={"errors": [{"reason": "invalid_state"}]})

        start, end = c.starts_at, c.ends_at
        axes = (c.prize_config or {}).get("axes", []) or []
        user_xp: dict[uuid.UUID, int] = {}
        user_coin: dict[uuid.UUID, int] = {}
        user_tiers: dict[uuid.UUID, set] = {}
        selected_ids: set = set()
        hof_ids: set = set()
        for ax in axes:
            key = ax.get("key")
            top = int(ax.get("top", 0) or 0)
            xp_list = ax.get("xp", []) or []
            coin_list = ax.get("coin", []) or []
            if key == "approve_votes":
                rows, idea_based = repo.rank_approve_votes(ts, c.quest_id, start=start, end=end), True
            elif key == "avg_score":
                rows, idea_based = repo.rank_avg_score(ts, c.quest_id, start=start, end=end), True
            elif key == "contribution":
                rows, idea_based = repo.rank_contribution(ts, c.quest_id, start=start, end=end), False
            else:
                continue
            for rank, row in enumerate(rows[:top]):
                if idea_based:
                    iid, beneficiary, _metric = row
                    selected_ids.add(iid)
                    if rank == 0:
                        hof_ids.add(iid)  # 各成果軸の1位は殿堂入り
                else:
                    beneficiary, _metric = row
                user_xp[beneficiary] = user_xp.get(beneficiary, 0) + (xp_list[rank] if rank < len(xp_list) else 0)
                user_coin[beneficiary] = user_coin.get(beneficiary, 0) + (coin_list[rank] if rank < len(coin_list) else 0)
                tier = _TIER_BY_RANK.get(rank)
                if tier is not None:
                    user_tiers.setdefault(beneficiary, set()).add(tier)

        granted_now = 0
        winners = set(user_xp) | set(user_coin) | set(user_tiers)
        users = quests_repo.get_users_by_ids(ts, winners)
        # XP/コインはユーザー単位で1回ずつ（軸横断合算・冪等）。
        for uid in winners:
            u = users.get(uid)
            if u is None:
                continue
            xp = user_xp.get(uid, 0)
            if xp > 0 and not gami_repo.grant_exists_by_ref(ts, uid, kind=ledger.XP_GAIN, reason="contest_award",
                                                            ref_type="contests", ref_id=c.id):
                ledger.grant(ts, u, kind=ledger.XP_GAIN, amount=xp, reason="contest_award",
                             ref_type="contests", ref_id=c.id, quest_id=c.quest_id)
                granted_now += 1
            coin = user_coin.get(uid, 0)
            if coin > 0 and not gami_repo.grant_exists_by_ref(ts, uid, kind=ledger.COIN_GAIN, reason="contest_award",
                                                              ref_type="contests", ref_id=c.id):
                ledger.grant(ts, u, kind=ledger.COIN_GAIN, amount=coin, reason="contest_award",
                             ref_type="contests", ref_id=c.id, quest_id=c.quest_id)
                granted_now += 1
            # 入賞バッジ（得た最上位ティアを解除・冪等）＝migration 0052 の contest_award_{tier}。
            for tier in user_tiers.get(uid, set()):
                ach = ach_repo.get_by_code(ts, f"contest_award_{tier}")
                if ach is None:
                    continue
                ua = ach_repo.upsert_user_achievement(ts, uid, ach.id, current=1, target=None)
                if ua.unlocked_at is None:
                    ua.unlocked_at = datetime.now(timezone.utc)
                    ach_engine._notify_achievement(ts, u, ach)
                    granted_now += 1

        # 入賞アイデアに is_selected＋殿堂入りフラグ（いずれも冪等）。
        for iid in selected_ids:
            idea = ideas_repo.get_idea(ts, iid)
            if idea is not None and not idea.is_selected:
                idea.is_selected = True
        for iid in hof_ids:
            repo.set_idea_flag(ts, contest_id=c.id, idea_id=iid, flag="hall_of_fame", granted_by_id=user.id)

        if c.status == "judging":
            c.status = "closed"
            quest = ts.get(Quest, c.quest_id)
            if quest is not None:
                quest.status = _QUEST_STATUS["closed"]
        out = {"status": c.status, "awarded_users": len(winners),
               "selected_ideas": len(selected_ids), "granted_now": granted_now}
        ts.commit()
    return out


def auto_shelve_expired(account_id: uuid.UUID, company_id: uuid.UUID, contest_id: str) -> dict:
    """rolling コンテストの期限超過アイデアに「お蔵入り（shelved）」を自動付与（T-TC-132・§4.2）。

    `auto_archive_days` 経過（公開アイデアの created_at 基準）で `contest_idea_flags(shelved)` を冪等付与。
    MVP は明示トリガ（スケジューラ後追い＝設計 §6.2）。bounded/未設定は no-op。
    """
    from datetime import timedelta
    from app.tenant.ideas import repository as ideas_repo

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
            raise AppError(403, "forbidden", detail="自動アーカイブを実行する権限がありません")
        shelved = 0
        if c.mode == "rolling" and c.auto_archive_days:
            cutoff = datetime.now(timezone.utc) - timedelta(days=int(c.auto_archive_days))
            for idea in ideas_repo.list_published_ideas_for_quest(ts, c.quest_id):
                if idea.created_at < cutoff and repo.get_idea_flag(ts, idea.id, "shelved") is None:
                    repo.set_idea_flag(ts, contest_id=c.id, idea_id=idea.id, flag="shelved", granted_by_id=user.id)
                    shelved += 1
        out = {"shelved": shelved}
        ts.commit()
    return out
