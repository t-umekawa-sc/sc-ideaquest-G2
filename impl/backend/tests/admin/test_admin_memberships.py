"""発行/編集 API の memberships 相乗テスト（doc/テスト/B §4.3/§4.4・API設計 B.2/B.2.1/B.3/B.5）。

発行（B-TC-072〜074）＝ボディの初期所属 memberships を account_sync_outbox payload に相乗し、
worker（§4.2）が会社DB quest_group_members へ適用する end-to-end。編集（B-TC-075〜077）＝既存
アカウント（users ミラー存在）の memberships 差分を会社DB へ直接 upsert/remove（outbox 非経由・B.3）。
発行アカウント・所属・グループは teardown で物理削除。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.account_sync.application import process_outbox_once
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account, Company, OtpChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
import uuid

from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.admin.test_admin_self import _login_company_admin
from tests.conftest import SEED_COMPANY_CODE


def _company():
    with control_session() as s:
        c = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        return c.id, c.db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _ident() -> dict:
    u = uuid.uuid4().hex[:8]
    return {"display_name": f"New {u}", "login_id": f"new-{u}@acme.example", "email": f"new-{u}@acme.example"}


def _active_members(db_id: str, group_id: uuid.UUID) -> list[QuestGroupMember]:
    with get_tenant_session(db_id) as ts:
        return list(ts.execute(
            select(QuestGroupMember).where(
                QuestGroupMember.quest_group_id == group_id,
                QuestGroupMember.removed_at.is_(None),
            )
        ).scalars())


@pytest.fixture
def mem_env():
    """ACME-01 にグループを seed でき、発行/所属を teardown で物理削除する環境。"""
    cid, db_id = _company()
    accounts: list[uuid.UUID] = []
    groups: list[uuid.UUID] = []

    def make_group() -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_id) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:8].upper()}", name="G"))
            ts.commit()
        groups.append(gid)
        return gid

    def seed_user_membership(group_id: uuid.UUID, user_id: uuid.UUID, *, role: str = "member") -> None:
        with get_tenant_session(db_id) as ts:
            ts.add(QuestGroupMember(id=uuid.uuid4(), quest_group_id=group_id, user_id=user_id, role=role))
            ts.commit()

    yield SimpleNamespace(cid=cid, db_id=db_id, make_group=make_group,
                          seed_user_membership=seed_user_membership, track=accounts.append)

    with get_tenant_session(db_id) as ts:  # members（→users FK）を users より先に削除
        for gid in groups:
            ts.query(QuestGroupMember).filter_by(quest_group_id=gid).delete()
        for gid in groups:
            ts.query(QuestGroup).filter_by(id=gid).delete()
        for aid in accounts:
            ts.query(User).filter_by(account_id=aid).delete()
        ts.commit()
    with control_session() as s:
        for aid in accounts:
            s.query(OutboxEntry).filter_by(account_id=aid).delete()
            s.query(MailOutboxEntry).filter_by(account_id=aid).delete()
            s.query(OtpChallenge).filter_by(account_id=aid).delete()
            s.query(Account).filter_by(id=aid).delete()
        s.commit()


def _issue(client, url: str, body: dict):
    return client.post(url, json=body, headers=_csrf(client))


# --- B-TC-072: system_admin 発行の memberships 相乗（end-to-end） ---------------------
def test_b_tc_072_system_admin_issue_with_memberships(client, mem_env):
    """B-TC-072 memberships 付き発行→outbox payload 相乗→worker で quest_group_members（role=admin）。B.2/B.5。"""
    _login_system_admin(client)
    gid = mem_env.make_group()
    body = {**_ident(), "memberships": [{"group_id": str(gid), "role": "admin"}]}

    r = _issue(client, f"/api/v1/admin/companies/{mem_env.cid}/accounts", body)

    assert r.status_code == 201, r.text
    aid = uuid.UUID(r.json()["account_id"])
    mem_env.track(aid)
    with control_session() as s:
        entry = s.query(OutboxEntry).filter_by(account_id=aid).one()
    assert entry.payload.get("memberships") == [{"group_id": str(gid), "role": "admin"}]

    process_outbox_once()
    with get_tenant_session(mem_env.db_id) as ts:
        user = get_user_by_account(ts, aid)
    members = _active_members(mem_env.db_id, gid)
    assert len(members) == 1
    assert members[0].user_id == user.id and members[0].role == "admin"


# --- B-TC-073: 会社アカウント管理者も role=admin 任命可（B.2.1・2026-08-02） -----------
def test_b_tc_073_company_admin_issue_with_admin_membership(client, factory, mem_env):
    """B-TC-073 会社アカ管理者の発行でも memberships に role=admin を含められる（B.2.1）。"""
    _login_company_admin(client, factory)
    gid = mem_env.make_group()
    body = {**_ident(), "memberships": [{"group_id": str(gid), "role": "admin"}]}

    r = _issue(client, "/api/v1/admin/accounts", body)

    assert r.status_code == 201, r.text
    aid = uuid.UUID(r.json()["account_id"])
    mem_env.track(aid)
    with control_session() as s:
        entry = s.query(OutboxEntry).filter_by(account_id=aid).one()
    assert entry.payload.get("memberships") == [{"group_id": str(gid), "role": "admin"}]


# --- B-TC-074: memberships のバリデーション（422） -----------------------------------
def test_b_tc_074_membership_validation(client, mem_env):
    """B-TC-074 不正 role（Literal 外）・想定外プロパティは 422（extra=forbid・§B.6）。"""
    _login_system_admin(client)
    gid = mem_env.make_group()
    url = f"/api/v1/admin/companies/{mem_env.cid}/accounts"

    bad_role = {**_ident(), "memberships": [{"group_id": str(gid), "role": "owner"}]}
    assert _issue(client, url, bad_role).status_code == 422

    extra = {**_ident(), "memberships": [{"group_id": str(gid), "role": "member", "x": 1}]}
    assert _issue(client, url, extra).status_code == 422
