"""ソリューション開発（ドメイン Q・FR-43）の imperative shell（UoW 境界・門番・完了報酬）。

門番＝二層メンバーシップ（§5.49b・Q.0）＝プロジェクト参照/操作は
`can_access_project = owner OR project_member OR is_quest_party(quest_id)`。
コンセプト非依存（quest_id NULL）は owner＋project_members のみ。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from app.control_plane.auth.orm import Company
from app.core.errors import AppError
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.chat import repository as chat_repo
from app.tenant.concepts import repository as concepts_repo
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.profile import repository as profile_repo
from app.tenant.quests import repository as quests_repo
from app.tenant.solutions import repository as repo
from app.tenant.solutions.orm import Project, ProjectMember, Task

_DELIVERY_XP_DONE = 20  # タスク完了の開発XP（初期値・調整可）
_COIN_DONE = 10         # タスク完了のコイン（初期値・調整可）
_TASK_KINDS = {"requirement", "task"}
_TASK_STATUSES = {"todo", "doing", "done", "blocked"}
_PROJECT_STATUSES = {"planning", "in_progress", "on_hold", "done"}
_ROLES = {"lead", "member"}


# ---- ctx ----
def _resolve_company(company_id: uuid.UUID) -> Company | None:
    with control_session() as s:
        return s.get(Company, company_id)


def _parse_uuid(value: str, *, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def _ctx(account_id, company_id):
    company = _resolve_company(company_id)
    if company is None:
        raise AppError(401, "unauthenticated")
    return company


def _get_user(ts, account_id):
    user = profile_repo.get_user_by_account(ts, account_id)
    if user is None:
        raise AppError(401, "unauthenticated")
    return user


# ---- permission ----
def _quest_of(ts, project: Project):
    return quests_repo.get_quest(ts, project.quest_id) if project.quest_id else None


def _quest_perms(ts, quest, user) -> list[str]:
    if quest is None:
        return []
    member = quests_repo.get_active_member(ts, quest.id, user.id)
    return quests_repo.get_permissions(ts, member.id) if member is not None else []


def _is_quest_manager(ts, quest, user) -> bool:
    if quest is not None and quest.owner_id == user.id:
        return True
    return "quest_admin" in _quest_perms(ts, quest, user)


def _is_quest_party(ts, quest, user) -> bool:
    return quest is not None and quests_repo.can_access_quest(ts, quest, user.id)


def _is_in_access_group(ts, project: Project, user) -> bool:
    """参加グループ（アクセス条件）＝プロジェクトに紐づくグループのいずれかに現在有効所属していれば参照可。"""
    group_ids = repo.list_project_group_ids(ts, project.id)
    if not group_ids:
        return False
    return user.id in quests_repo.user_ids_in_any_group(ts, group_ids)


def can_access_project(ts, project: Project, user) -> bool:
    if project.owner_account_id == user.id:
        return True
    if repo.get_member(ts, project.id, user.id) is not None:
        return True
    if _is_quest_party(ts, _quest_of(ts, project), user):
        return True
    return _is_in_access_group(ts, project, user)


def _dev_role(ts, project, user) -> str | None:
    m = repo.get_member(ts, project.id, user.id)
    return m.role if m is not None else None


def _can_manage_tasks(ts, project, user, quest) -> bool:
    return (
        project.owner_account_id == user.id
        or _dev_role(ts, project, user) == "lead"
        or _is_quest_manager(ts, quest, user)
    )


def _can_manage_members(ts, project, user, quest) -> bool:
    return project.owner_account_id == user.id or _is_quest_manager(ts, quest, user)


def _can_update_status(ts, project, user, quest, task: Task) -> bool:
    if _can_manage_tasks(ts, project, user, quest):
        return True
    return task.assignee_account_id == user.id  # 担当者は自分のタスクの状態を更新可（Q.0）


def _require_access(ts, project, user) -> None:
    if project is None or not can_access_project(ts, project, user):
        raise AppError(404, "not_found")  # 範囲外は秘匿（Q.0）


# ---- DTO helpers ----
def _user_ref(ts, user_id: uuid.UUID | None) -> dict | None:
    if user_id is None:
        return None
    from app.tenant.profile.orm import User
    row = ts.get(User, user_id)
    if row is None:
        return None
    return {"user_id": str(row.id), "display_name": row.display_name, "avatar_image_url": row.avatar_image_path}


def _progress(tasks: list[Task]) -> dict:
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    return {"done": done, "total": total}


def _project_ref(ts, project: Project) -> dict | None:
    return {"id": str(project.id), "title": project.title}


def _concept_ref(ts, project: Project) -> dict | None:
    if not project.concept_id:
        return None
    c = concepts_repo.get_concept(ts, project.concept_id)
    return {"id": str(project.concept_id), "title": c.title if c else "(削除済み)"}


def _quest_ref(ts, project: Project) -> dict | None:
    if not project.quest_id:
        return None
    q = quests_repo.get_quest(ts, project.quest_id)
    return {"id": str(project.quest_id), "title": q.title if q else "(不明)"}


def _viewer_domain(ts, project, user, quest) -> str:
    dev = repo.get_member(ts, project.id, user.id) is not None or project.owner_account_id == user.id
    inv = _is_quest_party(ts, quest, user)
    if dev and inv:
        return "both"
    return "dev" if dev else "innovation"


def _list_item(ts, project: Project) -> dict:
    tasks = repo.list_tasks(ts, project.id)
    return {
        "id": str(project.id), "title": project.title, "status": project.status,
        "concept": _concept_ref(ts, project), "quest": _quest_ref(ts, project),
        "progress": _progress(tasks), "task_count": len(tasks),
        "owner": _user_ref(ts, project.owner_account_id),
        "updated_at": project.updated_at.isoformat(),
    }


def _detail(ts, project: Project, user) -> dict:
    quest = _quest_of(ts, project)
    tasks = repo.list_tasks(ts, project.id)
    return {
        "id": str(project.id), "title": project.title, "description": project.description,
        "status": project.status, "deployment": project.deployment or {}, "external_link": project.external_link,
        "concept": _concept_ref(ts, project), "quest": _quest_ref(ts, project),
        "owner": _user_ref(ts, project.owner_account_id), "progress": _progress(tasks),
        "group_ids": [str(g) for g in repo.list_project_group_ids(ts, project.id)],
        "viewer_domain": _viewer_domain(ts, project, user, quest),
        "viewer_user_id": str(user.id),
        "my_permissions": {
            "can_edit": project.owner_account_id == user.id or _is_quest_manager(ts, quest, user),
            "can_manage_members": _can_manage_members(ts, project, user, quest),
            "can_manage_tasks": _can_manage_tasks(ts, project, user, quest),
        },
    }


def _task_node(ts, t: Task, children_by_parent: dict) -> dict:
    return {
        "id": str(t.id), "project_id": str(t.project_id),
        "parent_task_id": str(t.parent_task_id) if t.parent_task_id else None,
        "kind": t.kind, "title": t.title, "description": t.description,
        "assignee": _user_ref(ts, t.assignee_account_id), "status": t.status,
        "sort_order": t.sort_order, "due_date": t.due_date.isoformat() if t.due_date else None,
        "done_at": t.done_at.isoformat() if t.done_at else None,
        "children": [_task_node(ts, c, children_by_parent) for c in children_by_parent.get(t.id, [])],
    }


def _task_tree(ts, project_id: uuid.UUID) -> list[dict]:
    tasks = repo.list_tasks(ts, project_id)
    children_by_parent: dict = {}
    for t in tasks:
        children_by_parent.setdefault(t.parent_task_id, []).append(t)
    roots = children_by_parent.get(None, [])
    return [_task_node(ts, t, children_by_parent) for t in roots]


# ---- reward ----
def _award_task_done(ts, task: Task) -> None:
    """タスク完了で開発XP＋コインを冪等付与（§5.27・(reason,ref_type,ref_id) 存在チェック）。担当者に付与。"""
    if task.assignee_account_id is None:
        return
    from app.tenant.profile.orm import User
    assignee = ts.get(User, task.assignee_account_id)
    if assignee is None:
        return
    if gami_repo.exists_ref(ts, assignee.id, ledger.DELIVERY_XP_GAIN, "task_done", "tasks", task.id):
        return
    ledger.grant(ts, assignee, kind=ledger.DELIVERY_XP_GAIN, amount=_DELIVERY_XP_DONE, reason="task_done",
                 ref_type="tasks", ref_id=task.id, judge=False)
    ledger.grant(ts, assignee, kind=ledger.COIN_GAIN, amount=_COIN_DONE, reason="task_done",
                 ref_type="tasks", ref_id=task.id, judge=False)


# ---- endpoints (projects) ----
def _apply_group_links(ts, project: Project, group_ids) -> None:
    """参加グループ（アクセス条件）を登録＝会社の quest_groups を指す（存在検証）。"""
    if not group_ids:
        return
    gids = [_parse_uuid(g, field="group_ids") for g in group_ids]
    from app.tenant.quest_group.orm import QuestGroup
    for gid in gids:
        if ts.get(QuestGroup, gid) is None:
            raise AppError(422, "validation_error", detail="対象グループが見つかりません", errors=[{"field": "group_ids"}])
    repo.create_project_group_links(ts, project.id, gids)


def create_from_concept(account_id, company_id, concept_id, *, title=None, description=None, deployment=None, members=None, group_ids=None) -> dict:
    company = _ctx(account_id, company_id)
    cid = _parse_uuid(concept_id, field="concept_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        concept = concepts_repo.get_concept(ts, cid)
        if concept is None:
            raise AppError(404, "not_found")
        quest = quests_repo.get_quest(ts, concept.quest_id)
        if quest is None or not quests_repo.can_access_quest(ts, quest, user.id):
            raise AppError(404, "not_found")
        if not _is_quest_manager(ts, quest, user):
            raise AppError(403, "forbidden", detail="プロジェクト起票は owner/quest_admin のみ")
        if concept.decision != "go":
            raise AppError(409, "conflict", detail="go 判定のコンセプトのみ起票できます", extra={"errors": [{"reason": "invalid_state"}]})
        if repo.get_project_by_concept(ts, cid) is not None:
            raise AppError(409, "conflict", detail="このコンセプトのプロジェクトは既に存在します")
        project = repo.create_project(ts, concept_id=cid, quest_id=concept.quest_id,
                                      title=(title or f"{concept.title} 開発"), description=description,
                                      owner_account_id=user.id, deployment=deployment)
        _apply_members(ts, project, members)
        _apply_group_links(ts, project, group_ids)
        ts.commit()
        return _detail(ts, project, user)


def create_standalone(account_id, company_id, *, title, description=None, deployment=None, members=None, group_ids=None) -> dict:
    company = _ctx(account_id, company_id)
    if not (title or "").strip():
        raise AppError(422, "validation_error", detail="プロジェクト名は必須です", errors=[{"field": "title"}])
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.create_project(ts, concept_id=None, quest_id=None, title=title.strip(),
                                      description=description, owner_account_id=user.id, deployment=deployment)
        _apply_members(ts, project, members)
        _apply_group_links(ts, project, group_ids)
        ts.commit()
        return _detail(ts, project, user)


def _apply_members(ts, project: Project, members) -> None:
    for m in (members or []):
        uid = _parse_uuid(m.get("user_id"), field="user_id")
        role = m.get("role") or "member"
        if role not in _ROLES:
            raise AppError(422, "validation_error", detail="role が不正です", errors=[{"field": "role"}])
        from app.tenant.profile.orm import User
        if ts.get(User, uid) is None:
            raise AppError(422, "validation_error", detail="対象ユーザーが見つかりません", errors=[{"field": "user_id"}])
        if repo.get_member(ts, project.id, uid) is None:
            repo.add_member(ts, project_id=project.id, user_id=uid, role=role)


def list_projects(account_id, company_id) -> list[dict]:
    company = _ctx(account_id, company_id)
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        return [_list_item(ts, p) for p in repo.list_projects(ts) if can_access_project(ts, p, user)]


def get_detail(account_id, company_id, project_id) -> dict:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        return _detail(ts, project, user)


def update_project(account_id, company_id, project_id, *, patch: dict) -> dict:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not (project.owner_account_id == user.id or _is_quest_manager(ts, quest, user)):
            raise AppError(403, "forbidden", detail="編集は起票者/owner のみ")
        if "title" in patch and patch["title"] is not None:
            if not str(patch["title"]).strip():
                raise AppError(422, "validation_error", detail="プロジェクト名は必須です", errors=[{"field": "title"}])
            project.title = str(patch["title"]).strip()
        if "description" in patch:
            project.description = patch["description"]
        if "status" in patch and patch["status"] is not None:
            if patch["status"] not in _PROJECT_STATUSES:
                raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
            project.status = patch["status"]
        if "deployment" in patch and patch["deployment"] is not None:
            project.deployment = patch["deployment"]
        if "external_link" in patch:
            project.external_link = patch["external_link"]
        if "group_ids" in patch and patch["group_ids"] is not None:
            gids = [_parse_uuid(g, field="group_ids") for g in patch["group_ids"]]
            from app.tenant.quest_group.orm import QuestGroup
            for gid in gids:
                if ts.get(QuestGroup, gid) is None:
                    raise AppError(422, "validation_error", detail="対象グループが見つかりません", errors=[{"field": "group_ids"}])
            repo.reconcile_project_group_links(ts, project.id, gids)
        repo.touch_project(ts, project)
        ts.commit()
        return _detail(ts, project, user)


def delete_project(account_id, company_id, project_id) -> None:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not (project.owner_account_id == user.id or _is_quest_manager(ts, quest, user)):
            raise AppError(403, "forbidden", detail="削除は起票者/owner のみ")
        repo.soft_delete_project(ts, project)
        ts.commit()


# ---- endpoints (members) ----
def list_members(account_id, company_id, project_id) -> dict:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        members = [{"user": _user_ref(ts, m.user_id), "role": m.role, "added_at": m.added_at.isoformat()}
                   for m in repo.list_members(ts, project.id)]
        # イノベーション担当＝由来クエストのパーティー（読み取り・参照＋口出し可）
        innovation = _innovation_members(ts, project)
        return {"members": members, "innovation_members": innovation}


def _innovation_members(ts, project: Project) -> list[dict]:
    if not project.quest_id:
        return []
    out: list[dict] = []
    for m in quests_repo.list_active_members(ts, project.quest_id):
        ref = _user_ref(ts, m.user_id)
        if ref:
            out.append(ref)
    return out


def add_member(account_id, company_id, project_id, *, user_id, role="member") -> dict:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not _can_manage_members(ts, project, user, quest):
            raise AppError(403, "forbidden", detail="メンバー管理は起票者/owner のみ")
        _apply_members(ts, project, [{"user_id": user_id, "role": role}])
        ts.commit()
        m = repo.get_member(ts, project.id, _parse_uuid(user_id, field="user_id"))
        return {"user": _user_ref(ts, m.user_id), "role": m.role, "added_at": m.added_at.isoformat()}


def update_member(account_id, company_id, project_id, member_user_id, *, role) -> dict:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    uid = _parse_uuid(member_user_id, field="user_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not _can_manage_members(ts, project, user, quest):
            raise AppError(403, "forbidden")
        if role not in _ROLES:
            raise AppError(422, "validation_error", detail="role が不正です", errors=[{"field": "role"}])
        m = repo.get_member(ts, project.id, uid)
        if m is None:
            raise AppError(404, "not_found")
        m.role = role
        ts.flush()
        ts.commit()
        return {"user": _user_ref(ts, m.user_id), "role": m.role, "added_at": m.added_at.isoformat()}


def remove_member(account_id, company_id, project_id, member_user_id) -> None:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    uid = _parse_uuid(member_user_id, field="user_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not _can_manage_members(ts, project, user, quest):
            raise AppError(403, "forbidden")
        m = repo.get_member(ts, project.id, uid)
        if m is None:
            raise AppError(404, "not_found")
        repo.remove_member(ts, m)
        ts.commit()


# ---- endpoints (tasks) ----
def list_tasks(account_id, company_id, project_id) -> list[dict]:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        return _task_tree(ts, project.id)


def recent_task_chats(account_id, company_id, project_id, *, limit: int = 8) -> dict:
    """🕒 最近の議論（プロジェクト内タスクのチャット限定・更新順・既読/未読問わず・SC-71）。
    ダッシュボードの recent_chats と同形だが、対象を当該プロジェクトのタスクチャットに限定する。
    """
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        tasks = {t.id: t for t in repo.list_tasks(ts, project.id)}
        rows = chat_repo.task_threads_with_activity(ts, user.id, list(tasks.keys()), limit=limit)
        items = []
        for tid, unread, last_at in rows:
            t = tasks.get(tid)
            if t is None:
                continue
            items.append({
                "task_id": str(tid), "title": t.title,
                "unread_chat_count": unread,
                "last_chat_at": last_at.isoformat() if last_at else None,
            })
        return {"items": items}


def _validate_assignee(ts, project, assignee_id_raw):
    if assignee_id_raw is None:
        return None
    aid = _parse_uuid(assignee_id_raw, field="assignee_account_id")
    if repo.get_member(ts, project.id, aid) is None:
        raise AppError(422, "validation_error", detail="担当者は開発メンバーに限ります", errors=[{"field": "assignee_account_id"}])
    return aid


def _parse_date(v, field):
    if not v:
        return None
    try:
        return date.fromisoformat(str(v))
    except ValueError:
        raise AppError(422, "validation_error", detail=f"{field} が不正です", errors=[{"field": field}])


def create_task(account_id, company_id, project_id, *, body: dict) -> dict:
    company = _ctx(account_id, company_id)
    pid = _parse_uuid(project_id, field="project_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        project = repo.get_project(ts, pid)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not _can_manage_tasks(ts, project, user, quest):
            raise AppError(403, "forbidden", detail="タスク作成は起票者/開発リード/owner のみ")
        title = (body.get("title") or "").strip()
        if not title:
            raise AppError(422, "validation_error", detail="タイトルは必須です", errors=[{"field": "title"}])
        kind = body.get("kind") or "task"
        if kind not in _TASK_KINDS:
            raise AppError(422, "validation_error", detail="kind が不正です", errors=[{"field": "kind"}])
        status = body.get("status") or "todo"
        if status not in _TASK_STATUSES:
            raise AppError(422, "validation_error", detail="status が不正です", errors=[{"field": "status"}])
        parent_id = None
        if body.get("parent_task_id"):
            parent_id = _parse_uuid(body["parent_task_id"], field="parent_task_id")
            parent = repo.get_task(ts, parent_id)
            if parent is None or parent.project_id != project.id:
                raise AppError(422, "validation_error", detail="親タスクが不正です", errors=[{"field": "parent_task_id"}])
        assignee = _validate_assignee(ts, project, body.get("assignee_account_id"))
        task = repo.create_task(ts, project_id=project.id, parent_task_id=parent_id, kind=kind, title=title,
                                description=body.get("description"), assignee_account_id=assignee, status=status,
                                sort_order=int(body.get("sort_order") or 0), due_date=_parse_date(body.get("due_date"), "due_date"))
        # タスク自身をホストにチャットスレッドを冪等生成（Q.4・中核無改修）
        from app.tenant.chat import repository as chat_repo
        chat_repo.ensure_chat_thread(ts, "task", task.id)
        if status == "done":
            _award_task_done(ts, task)
        repo.touch_project(ts, project)
        ts.commit()
        return _single_task(ts, task)


def update_task(account_id, company_id, task_id, *, body: dict) -> dict:
    company = _ctx(account_id, company_id)
    tid = _parse_uuid(task_id, field="task_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        task = repo.get_task(ts, tid)
        if task is None:
            raise AppError(404, "not_found")
        project = repo.get_project(ts, task.project_id)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        status_change = "status" in body and body["status"] is not None and body["status"] != task.status
        # 状態のみの変更＝担当者/lead/owner。それ以外の編集＝lead/owner/起票者。
        other_edit = any(k in body for k in ("title", "kind", "description", "assignee_account_id", "due_date", "parent_task_id"))
        if other_edit and not _can_manage_tasks(ts, project, user, quest):
            raise AppError(403, "forbidden", detail="タスク編集は起票者/開発リード/owner のみ")
        if status_change and not _can_update_status(ts, project, user, quest, task):
            raise AppError(403, "forbidden", detail="状態更新は担当者/開発リード/owner のみ")
        if "title" in body and body["title"] is not None:
            if not str(body["title"]).strip():
                raise AppError(422, "validation_error", detail="タイトルは必須です", errors=[{"field": "title"}])
            task.title = str(body["title"]).strip()
        if "kind" in body and body["kind"] is not None:
            if body["kind"] not in _TASK_KINDS:
                raise AppError(422, "validation_error", detail="kind が不正です", errors=[{"field": "kind"}])
            task.kind = body["kind"]
        if "description" in body:
            task.description = body["description"]
        if "assignee_account_id" in body:
            task.assignee_account_id = _validate_assignee(ts, project, body["assignee_account_id"])
        if "due_date" in body:
            task.due_date = _parse_date(body["due_date"], "due_date")
        if "parent_task_id" in body:
            new_parent = None
            if body["parent_task_id"]:
                new_parent = _parse_uuid(body["parent_task_id"], field="parent_task_id")
                if new_parent == task.id:
                    raise AppError(422, "validation_error", detail="自身を親にできません", errors=[{"field": "parent_task_id"}])
                p = repo.get_task(ts, new_parent)
                if p is None or p.project_id != project.id:
                    raise AppError(422, "validation_error", detail="親タスクが不正です", errors=[{"field": "parent_task_id"}])
            task.parent_task_id = new_parent
        if status_change:
            task.status = body["status"]
            if task.status == "done":
                task.done_at = datetime.now(timezone.utc)
                _award_task_done(ts, task)
            else:
                task.done_at = None
        repo.touch_task(ts, task)
        repo.touch_project(ts, project)
        ts.commit()
        return _single_task(ts, task)


def delete_task(account_id, company_id, task_id) -> None:
    company = _ctx(account_id, company_id)
    tid = _parse_uuid(task_id, field="task_id")
    with get_tenant_session(company.db_identifier) as ts:
        user = _get_user(ts, account_id)
        task = repo.get_task(ts, tid)
        if task is None:
            raise AppError(404, "not_found")
        project = repo.get_project(ts, task.project_id)
        _require_access(ts, project, user)
        quest = _quest_of(ts, project)
        if not _can_manage_tasks(ts, project, user, quest):
            raise AppError(403, "forbidden")
        if repo.has_children(ts, task.id):
            raise AppError(409, "conflict", detail="子タスクがあります。先に子を処理してください", extra={"errors": [{"reason": "has_children"}]})
        repo.delete_task(ts, task)
        repo.touch_project(ts, project)
        ts.commit()


def _single_task(ts, task: Task) -> dict:
    return {
        "id": str(task.id), "project_id": str(task.project_id),
        "parent_task_id": str(task.parent_task_id) if task.parent_task_id else None,
        "kind": task.kind, "title": task.title, "description": task.description,
        "assignee": _user_ref(ts, task.assignee_account_id), "status": task.status,
        "sort_order": task.sort_order, "due_date": task.due_date.isoformat() if task.due_date else None,
        "done_at": task.done_at.isoformat() if task.done_at else None, "children": [],
    }
