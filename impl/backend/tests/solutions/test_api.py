"""Q-TC-101〜125: ソリューション開発（プロジェクト/タスク・FR-43・ドメイン Q）API。

seed 一般ユーザー（ACME-01）でログインし、会社DB にプロジェクト（コンセプト非依存 or go コンセプト由来）を作る。
二層メンバーシップ門番・完了報酬（開発XP＋コイン冪等）・タスクツリー・状態遷移を検証。teardown で作成データを物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.concepts.orm import Concept
from app.tenant.gamification.orm import Activity
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quests import repository as quests_repo
from app.tenant.quests.orm import Quest, QuestMember, QuestMemberPermission
from app.tenant.solutions.orm import Project, ProjectMember, Task
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _login_seed(client) -> None:
    _login(client, SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD)


@pytest.fixture
def env():
    with control_session() as s:
        db_identifier = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier
        account = s.execute(select(Account).where(Account.login_id == SEED_LOGIN)).scalars().one()
    with get_tenant_session(db_identifier) as ts:
        user_id = get_user_by_account(ts, account.id).id
    other_id = uuid.uuid4()
    quests: list[uuid.UUID] = []
    concepts: list[uuid.UUID] = []
    projects: list[uuid.UUID] = []
    with get_tenant_session(db_identifier) as ts:
        ts.add(User(id=other_id, account_id=uuid.uuid4(), display_name="Dev", locale="ja", status="active"))
        ts.commit()

    def make_quest(*, status="in_progress") -> uuid.UUID:
        qid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            quests_repo.create_quest(ts, quest_id=qid, owner_id=user_id, title="Q", color="#3B82F6", status=status)
            quests_repo.add_member(ts, qid, user_id, permissions=["owner"])
            ts.commit()
        quests.append(qid)
        return qid

    def make_concept(qid, *, decision="go", author=None) -> uuid.UUID:
        cid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(Concept(id=cid, quest_id=qid, author_id=author or user_id, title="C", status="active", decision=decision))
            ts.commit()
        concepts.append(cid)
        return cid

    def track_project(pid) -> None:
        projects.append(uuid.UUID(pid) if isinstance(pid, str) else pid)

    yield SimpleNamespace(
        db_identifier=db_identifier, user_id=user_id, other_id=other_id,
        make_quest=make_quest, make_concept=make_concept, projects=projects, track_project=track_project,
    )

    with get_tenant_session(db_identifier) as ts:
        all_pids = [p.id for p in ts.query(Project).all() if p.id in projects or (p.concept_id in concepts) or (p.quest_id in quests)]
        for pid in set(all_pids):
            tids = [t.id for t in ts.query(Task).filter(Task.project_id == pid).all()]
            if tids:
                ts.execute(Activity.__table__.delete().where(Activity.ref_type == "tasks", Activity.ref_id.in_(tids)))
            ts.execute(Task.__table__.delete().where(Task.project_id == pid))
            ts.execute(ProjectMember.__table__.delete().where(ProjectMember.project_id == pid))
            ts.execute(Project.__table__.delete().where(Project.id == pid))
        ts.execute(Concept.__table__.delete().where(Concept.id.in_(concepts or [uuid.uuid4()])))
        for qid in quests:
            ts.execute(QuestMemberPermission.__table__.delete().where(
                QuestMemberPermission.quest_member_id.in_(select(QuestMember.id).where(QuestMember.quest_id == qid))))
            ts.execute(QuestMember.__table__.delete().where(QuestMember.quest_id == qid))
            ts.execute(Quest.__table__.delete().where(Quest.id == qid))
        ts.execute(User.__table__.delete().where(User.id == other_id))
        ts.commit()


def _create_standalone(client, **body) -> dict:
    body.setdefault("title", "P")
    r = client.post("/api/v1/projects", json=body, headers=_csrf(client))
    return r


# ---- Q.1 projects ----
def test_q_tc_101_create_standalone(env, client):
    """Q-TC-101: コンセプト非依存プロジェクト作成＝201・concept/quest null・owner が詳細取得可。"""
    _login_seed(client)
    r = _create_standalone(client, title="単純タスク管理")
    assert r.status_code == 201, r.text
    body = r.json()
    env.track_project(body["id"])
    assert body["concept"] is None and body["quest"] is None
    assert body["my_permissions"]["can_manage_tasks"] is True
    got = client.get(f"/api/v1/projects/{body['id']}")
    assert got.status_code == 200


def test_q_tc_102_create_from_go_concept_unique(env, client):
    """Q-TC-102: go コンセプトから起票＝201（concept/quest 設定）・2回目は 409。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = env.make_concept(qid, decision="go")
    r = client.post(f"/api/v1/concepts/{cid}/project", json={}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    body = r.json()
    env.track_project(body["id"])
    assert body["concept"]["id"] == str(cid) and body["quest"]["id"] == str(qid)
    r2 = client.post(f"/api/v1/concepts/{cid}/project", json={}, headers=_csrf(client))
    assert r2.status_code == 409


def test_q_tc_103_gate_requires_go(env, client):
    """Q-TC-103: decision≠go は起票不可（409 invalid_state）。"""
    _login_seed(client)
    qid = env.make_quest()
    cid = env.make_concept(qid, decision="undecided")
    r = client.post(f"/api/v1/concepts/{cid}/project", json={}, headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_q_tc_105_access_gate_404(env, client):
    """Q-TC-105: アクセス範囲外プロジェクトは 404（存在秘匿）。"""
    _login_seed(client)
    # other ユーザー所有のコンセプト非依存プロジェクトを直接作成（seed ユーザーは非メンバー）。
    pid = uuid.uuid4()
    with get_tenant_session(env.db_identifier) as ts:
        ts.add(Project(id=pid, concept_id=None, quest_id=None, title="他人P", owner_account_id=env.other_id))
        ts.commit()
    env.track_project(pid)
    r = client.get(f"/api/v1/projects/{pid}")
    assert r.status_code == 404


# ---- Q.1b members ----
def test_q_tc_110_member_lifecycle(env, client):
    """Q-TC-110: 開発メンバー 追加(member)→役割変更(lead)→削除。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    r = client.post(f"/api/v1/projects/{p['id']}/members", json={"user_id": str(env.other_id), "role": "member"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "member"
    r2 = client.patch(f"/api/v1/projects/{p['id']}/members/{env.other_id}", json={"role": "lead"}, headers=_csrf(client))
    assert r2.status_code == 200 and r2.json()["role"] == "lead"
    r3 = client.delete(f"/api/v1/projects/{p['id']}/members/{env.other_id}", headers=_csrf(client))
    assert r3.status_code == 204


# ---- Q.2 tasks / Q.3 reward ----
def _add_task(client, pid, **body) -> dict:
    body.setdefault("title", "T")
    return client.post(f"/api/v1/projects/{pid}/tasks", json=body, headers=_csrf(client))


def test_q_tc_120_task_tree_any_depth(env, client):
    """Q-TC-120: タスク作成＝任意深さツリー（親→子→孫）を GET /tasks がネストで返す。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    parent = _add_task(client, p["id"], title="親", kind="requirement").json()
    child = _add_task(client, p["id"], title="子", parent_task_id=parent["id"]).json()
    grand = _add_task(client, p["id"], title="孫", parent_task_id=child["id"])
    assert grand.status_code == 201, grand.text
    tree = client.get(f"/api/v1/projects/{p['id']}/tasks").json()["tree"]
    assert len(tree) == 1 and tree[0]["title"] == "親"
    assert tree[0]["children"][0]["title"] == "子"
    assert tree[0]["children"][0]["children"][0]["title"] == "孫"


def test_q_tc_121_assignee_must_be_member(env, client):
    """Q-TC-121: 担当は開発メンバーに限る＝非メンバー指定は 422。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    r = _add_task(client, p["id"], assignee_account_id=str(env.other_id))
    assert r.status_code == 422, r.text


def test_q_tc_122_completion_reward_idempotent(env, client):
    """Q-TC-122: タスク完了で開発XP＋コインを冪等付与（done→todo→done で二重付与なし）。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    # 担当＝自分を開発メンバーに追加してから割り当て。
    client.post(f"/api/v1/projects/{p['id']}/members", json={"user_id": str(env.user_id), "role": "lead"}, headers=_csrf(client))
    task = _add_task(client, p["id"], assignee_account_id=str(env.user_id)).json()

    with get_tenant_session(env.db_identifier) as ts:
        before = ts.get(User, env.user_id).delivery_xp

    client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "done"}, headers=_csrf(client))
    client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "todo"}, headers=_csrf(client))
    client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "done"}, headers=_csrf(client))

    with get_tenant_session(env.db_identifier) as ts:
        after = ts.get(User, env.user_id).delivery_xp
        n = ts.execute(select(Activity).where(
            Activity.user_id == env.user_id, Activity.reason == "task_done",
            Activity.ref_type == "tasks", Activity.ref_id == uuid.UUID(task["id"]),
            Activity.kind == "delivery_xp_gain")).scalars().all()
    assert after == before + 20  # 初回のみ加算
    assert len(n) == 1  # 台帳も1件（冪等）


def test_q_tc_123_assignee_can_update_status(env, client):
    """Q-TC-123: 担当者は自分のタスクの状態を更新可（非管理でも）。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    client.post(f"/api/v1/projects/{p['id']}/members", json={"user_id": str(env.user_id), "role": "member"}, headers=_csrf(client))
    task = _add_task(client, p["id"], assignee_account_id=str(env.user_id)).json()
    r = client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "doing"}, headers=_csrf(client))
    assert r.status_code == 200 and r.json()["status"] == "doing"


def test_q_tc_124_delete_parent_with_children_409(env, client):
    """Q-TC-124: 子ありタスクの削除は 409（先に子を処理）。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    parent = _add_task(client, p["id"], title="親").json()
    _add_task(client, p["id"], title="子", parent_task_id=parent["id"])
    r = client.delete(f"/api/v1/tasks/{parent['id']}", headers=_csrf(client))
    assert r.status_code == 409, r.text


def test_q_tc_125_parent_cycle_rejected(env, client):
    """Q-TC-125: 親タスクに自身を指定すると 422。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    task = _add_task(client, p["id"], title="T").json()
    r = client.patch(f"/api/v1/tasks/{task['id']}", json={"parent_task_id": task["id"]}, headers=_csrf(client))
    assert r.status_code == 422, r.text
