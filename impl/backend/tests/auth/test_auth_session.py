"""GET /auth/session のテスト（doc/テスト/A_認証.md）。"""
from __future__ import annotations

import uuid

from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from tests.conftest import SEED_COMPANY_CODE, SEED_LOGIN, SEED_PASSWORD

LOGIN = "/api/v1/auth/login"
SESSION = "/api/v1/auth/session"


def _seed_db_identifier() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def test_a_tc_011_get_session_ok(client):
    """A-TC-011 有効セッションで GET /session→200＋A.6 スキーマ。根拠 A.1/A.6。"""
    client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    r = client.get(SESSION)
    assert r.status_code == 200
    body = r.json()
    for key in ("account_id", "company_id", "company_code", "system_role", "locale", "user"):
        assert key in body
    assert "created_at" not in body  # 内部フィールドを漏らさない（A.6 のみ）


def test_a_tc_012_get_session_no_session_401(client):
    """A-TC-012 セッション無しで GET /session→401。根拠 A.1。"""
    r = client.get(SESSION)
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"


def test_a_tc_101_session_is_qg_admin_true(client, factory):
    """A-TC-101 会社DBに有効 admin 所属を持つユーザーは session.is_qg_admin=true（B.4 ナビ出し分け）。"""
    db_id = _seed_db_identifier()
    acc = factory.make_seed_company_account()  # ACME-01・users ミラーあり
    gid = uuid.uuid4()
    with get_tenant_session(db_id) as ts:
        uid = get_user_by_account(ts, acc["id"]).id
        ts.add(QuestGroup(id=gid, quest_group_code=f"QGS-{uuid.uuid4().hex[:6].upper()}", name="G"))
        ts.add(QuestGroupMember(id=uuid.uuid4(), quest_group_id=gid, user_id=uid, role="admin"))
        ts.commit()
    try:
        client.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"]})
        assert client.get(SESSION).json()["is_qg_admin"] is True
    finally:
        with get_tenant_session(db_id) as ts:
            ts.query(QuestGroupMember).filter_by(quest_group_id=gid).delete()
            ts.query(QuestGroup).filter_by(id=gid).delete()
            ts.commit()


def test_a_tc_102_session_is_qg_admin_false(client):
    """A-TC-102 admin 所属を持たないユーザーは session.is_qg_admin=false。"""
    client.post(LOGIN, json={"company_code": SEED_COMPANY_CODE, "login_id": SEED_LOGIN, "password": SEED_PASSWORD})
    assert client.get(SESSION).json()["is_qg_admin"] is False
