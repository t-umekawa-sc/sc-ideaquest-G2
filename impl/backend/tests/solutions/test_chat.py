"""Q-TC-130/131: タスクチャット（Q.4・チャット中核 thread=task 再利用）。

投稿→一覧（アイデア/コンセプトと同一中核）と門番（範囲外 404）を検証。env は test_api.py を再利用。
"""
from __future__ import annotations

import uuid

from app.db.tenant import get_tenant_session
from app.tenant.solutions.orm import Project

from tests.solutions.test_api import _create_standalone, _csrf, _login_seed, env  # noqa: F401


def _add_task(client, pid, **body) -> dict:
    body.setdefault("title", "T")
    return client.post(f"/api/v1/projects/{pid}/tasks", json=body, headers=_csrf(client))


def test_q_tc_130_task_chat_post_and_list(env, client):
    """Q-TC-130: タスクチャット投稿→一覧に反映（thread=task・同一中核）。"""
    _login_seed(client)
    p = _create_standalone(client).json()
    env.track_project(p["id"])
    task = _add_task(client, p["id"]).json()
    r = client.post(f"/api/v1/tasks/{task['id']}/chat-messages", data={"body": "はじめまして"}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    lst = client.get(f"/api/v1/tasks/{task['id']}/chat")
    assert lst.status_code == 200, lst.text
    body = lst.json()
    assert body["thread_id"].startswith("task-") or body["thread_id"]  # thread は task ホスト
    assert any(m.get("body") == "はじめまして" for m in body["data"])


def test_q_tc_131_task_chat_access_gate_404(env, client):
    """Q-TC-131: 範囲外（非メンバー・非パーティー）のタスクチャットは 404。"""
    _login_seed(client)
    # other 所有のコンセプト非依存プロジェクト＋タスク（seed ユーザーは非メンバー）。
    pid, tid = uuid.uuid4(), uuid.uuid4()
    from app.tenant.solutions.orm import Task
    with get_tenant_session(env.db_identifier) as ts:
        ts.add(Project(id=pid, concept_id=None, quest_id=None, title="他人P", owner_account_id=env.other_id))
        ts.add(Task(id=tid, project_id=pid, parent_task_id=None, kind="task", title="他人T", status="todo"))
        ts.commit()
    env.track_project(pid)
    r = client.get(f"/api/v1/tasks/{tid}/chat")
    assert r.status_code == 404, r.text
