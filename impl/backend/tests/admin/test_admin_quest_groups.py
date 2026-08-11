"""QG管理者 API のテスト（doc/テスト/B §4.5・API設計 B.4・SC-90）。

QG管理者は per-group（`system_role` 非依存＝`general` でも当該グループに有効 `admin` 所属で QG管理者）。
`company_id` は受けずセッション会社固定。参加追加/除外は会社DB `quest_group_members` の per-group 行のみ
（アカウント本体には触れない＝SoD）。グループ・所属は会社DB へ直接 seed し teardown で物理削除。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.control_plane.audit.orm import SystemAuditLog
from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

QG = "/api/v1/admin/quest-groups"
DIRECTORY = "/api/v1/admin/company-directory"


def _company():
    with control_session() as s:
        c = s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()
        return c.id, c.db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


@pytest.fixture
def qg(client, factory):
    """ACME-01 でグループ/所属を seed し、QG管理者としてログインできる環境。teardown で物理削除。"""
    _, db_id = _company()
    groups: list[uuid.UUID] = []

    def make_group() -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_id) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:8].upper()}", name="G"))
            ts.commit()
        groups.append(gid)
        return gid

    def user_id(account_id) -> uuid.UUID:
        with get_tenant_session(db_id) as ts:
            return get_user_by_account(ts, account_id).id

    def seed_membership(group_id, account_id, role="member") -> None:
        with get_tenant_session(db_id) as ts:
            ts.add(QuestGroupMember(id=uuid.uuid4(), quest_group_id=group_id,
                                    user_id=user_id(account_id), role=role))
            ts.commit()

    def login(account) -> None:
        _login(client, account["company_code"], account["login_id"], account["password"])

    yield SimpleNamespace(
        db_id=db_id, make_group=make_group, seed_membership=seed_membership,
        user_id=user_id, login=login, new_account=lambda **kw: factory.make_seed_company_account(**kw),
    )

    with get_tenant_session(db_id) as ts:  # members（→users FK）を users より先に
        for gid in groups:
            ts.query(QuestGroupMember).filter_by(quest_group_id=gid).delete()
        for gid in groups:
            ts.query(QuestGroup).filter_by(id=gid).delete()
        ts.commit()


def _active_members(db_id, group_id):
    from sqlalchemy import select
    with get_tenant_session(db_id) as ts:
        return list(ts.execute(select(QuestGroupMember).where(
            QuestGroupMember.quest_group_id == group_id,
            QuestGroupMember.removed_at.is_(None),
        )).scalars())


# --- B-TC-080: 自分が admin のグループ一覧（general でも per-group admin） -----------------
def test_b_tc_080_list_admin_groups(client, factory, qg):
    """B-TC-080 general アカウントでも per-group admin 所属で QG管理者＝グループ一覧 200（member_count 付き）。"""
    admin_acc = qg.new_account()  # system_role=general
    g1 = qg.make_group()
    qg.seed_membership(g1, admin_acc["id"], "admin")
    qg.login(admin_acc)

    r = client.get(QG)

    assert r.status_code == 200, r.text
    groups = {g["group_id"]: g for g in r.json()["data"]}
    assert str(g1) in groups
    assert groups[str(g1)]["member_count"] >= 1


def test_b_tc_081_list_groups_forbidden_and_unauth(client, factory, qg):
    """B-TC-081 未認証は 401／admin 所属ゼロは 403（QG管理者でない）。"""
    assert client.get(QG).status_code == 401
    plain = qg.new_account()
    qg.login(plain)
    assert client.get(QG).status_code == 403


def test_b_tc_082_members_list_and_existence_hiding(client, factory, qg):
    """B-TC-082 admin は members 一覧 200／不明・非 admin・他会社グループは 404（存在秘匿・所属ベース）。"""
    admin_acc = qg.new_account()
    g1 = qg.make_group()
    qg.seed_membership(g1, admin_acc["id"], "admin")
    member_acc = qg.new_account()
    qg.seed_membership(g1, member_acc["id"], "member")
    qg.login(admin_acc)

    r = client.get(f"{QG}/{g1}/members")
    assert r.status_code == 200, r.text
    account_ids = {m["account_id"] for m in r.json()["data"]}
    assert str(member_acc["id"]) in account_ids

    assert client.get(f"{QG}/{uuid.uuid4()}/members").status_code == 404  # 不明グループ
    g2 = qg.make_group()  # actor は admin 所属を持たない
    assert client.get(f"{QG}/{g2}/members").status_code == 404


def test_b_tc_083_company_directory_minimal_projection(client, factory, qg):
    """B-TC-083 QG管理者はディレクトリ 200＋最小射影（email/system_role を出さない）／ゼロ admin は 403。"""
    admin_acc = qg.new_account()
    g1 = qg.make_group()
    qg.seed_membership(g1, admin_acc["id"], "admin")
    qg.login(admin_acc)

    r = client.get(DIRECTORY)
    assert r.status_code == 200, r.text
    items = r.json()["data"]
    assert items
    for i in items:
        assert set(i.keys()) <= {"account_id", "display_name", "avatar_url"}

    plain = qg.new_account()
    qg.login(plain)
    assert client.get(DIRECTORY).status_code == 403


# --- B-TC-084: 参加追加（role=member 固定・SoD・CSRF 必須） -----------------------------
def test_b_tc_084_add_member(client, factory, qg):
    """B-TC-084 admin が既存アカウントを参加追加＝201・role=member 固定・有効所属に現れる。CSRF 無しは 403。"""
    admin_acc = qg.new_account()
    g1 = qg.make_group()
    qg.seed_membership(g1, admin_acc["id"], "admin")
    target = qg.new_account()
    qg.login(admin_acc)

    # CSRF 無しは 403（変更系・B.0.1 P3）
    assert client.post(f"{QG}/{g1}/members", json={"account_id": str(target["id"])}).status_code == 403

    r = client.post(f"{QG}/{g1}/members", json={"account_id": str(target["id"])}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "member"  # QG管理者は admin 任命不可＝member 固定
    target_uid = qg.user_id(target["id"])
    assert any(m.user_id == target_uid for m in _active_members(qg.db_id, g1))


# --- B-TC-085: 除外（トゥームストーン・204・冪等） -----------------------------------
def test_b_tc_085_remove_member_idempotent(client, factory, qg):
    """B-TC-085 除外＝204＋removed_at 設定で有効所属から消える／2回目も 204（冪等・§5.5）。"""
    admin_acc = qg.new_account()
    g1 = qg.make_group()
    qg.seed_membership(g1, admin_acc["id"], "admin")
    target = qg.new_account()
    qg.seed_membership(g1, target["id"], "member")
    qg.login(admin_acc)
    target_uid = qg.user_id(target["id"])

    r1 = client.delete(f"{QG}/{g1}/members/{target['id']}", headers=_csrf(client))
    assert r1.status_code == 204
    assert not any(m.user_id == target_uid for m in _active_members(qg.db_id, g1))

    r2 = client.delete(f"{QG}/{g1}/members/{target['id']}", headers=_csrf(client))
    assert r2.status_code == 204  # 冪等


def _audit(action: str):
    with control_session() as s:
        return list(s.query(SystemAuditLog).filter_by(action=action).all())


def test_b_tc_103_membership_ops_audited(client, factory, qg):
    """B-TC-103 参加追加/除外が監査行を残す（actor=QG管理者・detail に group/account）。B.6/B.4。"""
    admin_acc = qg.new_account()
    g1 = qg.make_group()
    qg.seed_membership(g1, admin_acc["id"], "admin")
    target = qg.new_account()
    qg.login(admin_acc)

    r = client.post(f"{QG}/{g1}/members", json={"account_id": str(target["id"])}, headers=_csrf(client))
    assert r.status_code == 201, r.text
    add_rows = _audit("membership.add")
    assert len(add_rows) == 1
    assert str(add_rows[0].actor_account_id) == str(admin_acc["id"])   # 実行者＝QG管理者（general）
    assert add_rows[0].detail["group_id"] == str(g1) and add_rows[0].detail["account_id"] == str(target["id"])

    r2 = client.delete(f"{QG}/{g1}/members/{target['id']}", headers=_csrf(client))
    assert r2.status_code == 204
    assert len(_audit("membership.remove")) == 1
