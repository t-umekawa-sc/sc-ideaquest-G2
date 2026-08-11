"""account_sync_outbox（管理DB→会社DB users ミラー）のテスト（doc/テスト/B_会社・アカウント.md・§4.6）。

書込側の同一Tx INSERT（B-TC-001）と、常駐ワーカ本体 process_outbox_once の冪等適用/リトライ/順序
（B-TC-002〜005）、login 成功の last_login_at ミラー（B-TC-006）を int レベルで確認する。
ワーカは常駐せず関数を直接呼ぶ。
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.control_plane.account_sync import repository as sync_repo
from app.control_plane.account_sync.application import process_outbox_once
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account, Company
from app.core.config import get_settings
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from app.tenant.profile.repository import get_user_by_account
from app.tenant.quest_group.orm import QuestGroup, QuestGroupMember
from tests.conftest import SEED_COMPANY_CODE

COMPLETE = "/api/v1/auth/password-setup/complete"


def _seed_company_row() -> Company:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one()


def _outbox_for(account_id) -> list[OutboxEntry]:
    with control_session() as s:
        return list(
            s.query(OutboxEntry).filter_by(account_id=account_id).order_by(OutboxEntry.seq).all()
        )


def _user_password_set(db_identifier: str, account_id) -> bool | None:
    with get_tenant_session(db_identifier) as ts:
        u = ts.execute(
            User.__table__.select().where(User.account_id == account_id)
        ).mappings().first()
        return None if u is None else u["password_set"]


def _user_last_login(db_identifier: str, account_id):
    with get_tenant_session(db_identifier) as ts:
        u = ts.execute(
            User.__table__.select().where(User.account_id == account_id)
        ).mappings().first()
        return None if u is None else u["last_login_at"]


def _account_last_login(account_id):
    with control_session() as s:
        return s.query(Account).filter_by(id=account_id).one().last_login_at


def _enqueue(account_id, company_id, payload=None) -> None:
    with control_session() as s:
        sync_repo.enqueue(s, account_id, company_id, "upsert", payload or {"password_set": True})
        s.commit()


# --- B-TC-001: 書込側（同一Tx INSERT） ------------------------------------------------
def test_b_tc_001_complete_enqueues_outbox_same_tx(client, factory):
    """B-TC-001 complete 成功で accounts 更新と同一Tx に pending 1行。根拠 §4.6/ADR-0002 §2.4。"""
    acc = factory.make_seed_company_account()
    token = factory.make_password_setup_challenge(acc["id"])
    r = client.post(COMPLETE, json={"token": token, "new_password": "NewPassw0rd1"})
    assert r.status_code == 200

    rows = _outbox_for(acc["id"])
    assert len(rows) == 1
    assert rows[0].op == "upsert"
    assert rows[0].status == "pending"
    assert rows[0].payload.get("password_set") is True
    assert str(rows[0].company_id) == str(_seed_company_row().id)


# --- B-TC-002: ワーカ適用 --------------------------------------------------------------
def test_b_tc_002_worker_applies_mirror(client, factory):
    """B-TC-002 process_outbox_once で users.password_set=true・行 done。根拠 §4.6。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    assert _user_password_set(company.db_identifier, acc["id"]) is False  # 初期は未設定
    _enqueue(acc["id"], company.id)

    process_outbox_once()

    assert _user_password_set(company.db_identifier, acc["id"]) is True
    rows = _outbox_for(acc["id"])
    assert len(rows) == 1 and rows[0].status == "done" and rows[0].processed_at is not None


# --- B-TC-003: 冪等 --------------------------------------------------------------------
def test_b_tc_003_idempotent_upsert(client, factory):
    """B-TC-003 同一 account の upsert 2行を適用しても users は1行（冪等）。根拠 §4.6。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    _enqueue(acc["id"], company.id)
    _enqueue(acc["id"], company.id)

    process_outbox_once()

    assert _user_password_set(company.db_identifier, acc["id"]) is True
    with get_tenant_session(company.db_identifier) as ts:
        n = ts.execute(
            User.__table__.select().where(User.account_id == acc["id"])
        ).mappings().all()
    assert len(n) == 1  # upsert なので重複しない
    assert all(row.status == "done" for row in _outbox_for(acc["id"]))


# --- B-TC-004: リトライ→failed --------------------------------------------------------
def test_b_tc_004_retry_then_failed(client, factory, monkeypatch):
    """B-TC-004 会社DB 不在で失敗→attempts++→上限超で failed。根拠 §4.6。"""
    monkeypatch.setenv("OUTBOX_MAX_ATTEMPTS", "2")
    get_settings.cache_clear()
    try:
        company = factory.make_company()  # 実在しない db_identifier（接続失敗する）
        account = factory.make_account(company)
        _enqueue(account["id"], company["id"])

        process_outbox_once()
        rows = _outbox_for(account["id"])
        assert rows[0].attempts == 1 and rows[0].status == "pending"

        process_outbox_once()
        rows = _outbox_for(account["id"])
        assert rows[0].attempts == 2 and rows[0].status == "failed"
    finally:
        get_settings.cache_clear()


# --- B-TC-005: 順序（HOL ブロッキング＋account 独立） ---------------------------------
def test_b_tc_005_head_of_line_blocking_and_cross_account_independence(client, factory):
    """B-TC-005 失敗 account の後続は止め、別 account は独立に進む。根拠 §4.6（順序）。"""
    bad_company = factory.make_company()          # 会社DB 無し＝適用失敗する
    x = factory.make_account(bad_company)
    _enqueue(x["id"], bad_company["id"])          # X1（先行・失敗する）
    _enqueue(x["id"], bad_company["id"])          # X2（後続・ブロックされる想定）

    y = factory.make_seed_company_account()       # ACME-01（会社DB あり＝成功する）
    y_company = _seed_company_row()
    _enqueue(y["id"], y_company.id)               # Y1

    process_outbox_once()

    xrows = _outbox_for(x["id"])
    assert xrows[0].attempts == 1 and xrows[0].status == "pending"   # X1 は失敗（試行済み）
    assert xrows[1].attempts == 0 and xrows[1].status == "pending"   # X2 は未処理（HOL ブロック）

    yrows = _outbox_for(y["id"])
    assert yrows[0].status == "done"                                 # 別 account は独立に完了


# --- B-TC-006: last_login_at ミラー（ログイン成功時） ---------------------------------
LOGIN = "/api/v1/auth/login"


def test_b_tc_006_login_mirrors_last_login_at(client, factory):
    """B-TC-006 ログイン成功で accounts.last_login_at 更新＋同一Tx で outbox enqueue→worker で
    users.last_login_at へミラー。根拠 データモデル §4.6/§5.3（認証イベント③）。"""
    acc = factory.make_seed_company_account()          # ACME-01（MFA OFF）＝直接ログイン
    company = _seed_company_row()
    assert _account_last_login(acc["id"]) is None                    # 初期は未ログイン
    assert _user_last_login(company.db_identifier, acc["id"]) is None

    r = client.post(LOGIN, json={
        "company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"],
    })
    assert r.status_code == 200 and r.json()["status"] == "authenticated"

    assert _account_last_login(acc["id"]) is not None               # 源泉（accounts）更新
    rows = _outbox_for(acc["id"])
    assert len(rows) == 1 and rows[0].op == "upsert"                # 同一Tx で 1 行
    assert rows[0].payload.get("last_login_at")                     # payload に ISO 文字列

    process_outbox_once()                                            # 会社DB へミラー
    assert _user_last_login(company.db_identifier, acc["id"]) is not None


# --- B-TC-007: identity/role 列のミラー（§5.3） --------------------------------------
def _user_row(db_identifier: str, account_id):
    with get_tenant_session(db_identifier) as ts:
        return ts.execute(
            User.__table__.select().where(User.account_id == account_id)
        ).mappings().first()


def test_b_tc_007_mirror_identity_columns(client, factory):
    """B-TC-007 login_id/email/system_role が会社DB users へミラーされる（§5.3・会社DB単独一覧）。根拠 §4.6/§5.3。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    _enqueue(acc["id"], company.id, {
        "login_id": "mir@acme.example", "email": "mir@acme.example",
        "system_role": "company_account_admin",
    })
    process_outbox_once()
    row = _user_row(company.db_identifier, acc["id"])
    assert row["login_id"] == "mir@acme.example"
    assert row["email"] == "mir@acme.example"
    assert row["system_role"] == "company_account_admin"


# --- B-TC-069〜071: outbox worker の memberships 適用（発行相乗り・B.5 step3） ---------
@pytest.fixture
def qg():
    """会社DB に quest_group を seed。作成した group と所属は teardown で物理削除（users より先）。"""
    created: list[tuple[str, uuid.UUID]] = []  # (db_identifier, group_id)

    def make_group(db_identifier: str) -> uuid.UUID:
        gid = uuid.uuid4()
        with get_tenant_session(db_identifier) as ts:
            ts.add(QuestGroup(id=gid, quest_group_code=f"QG-{uuid.uuid4().hex[:8].upper()}", name="G"))
            ts.commit()
        created.append((db_identifier, gid))
        return gid

    yield SimpleNamespace(make_group=make_group)

    for db_identifier, gid in created:
        with get_tenant_session(db_identifier) as ts:
            ts.query(QuestGroupMember).filter_by(quest_group_id=gid).delete()
            ts.query(QuestGroup).filter_by(id=gid).delete()
            ts.commit()


def _active_members(db_identifier: str, group_id: uuid.UUID) -> list[QuestGroupMember]:
    with get_tenant_session(db_identifier) as ts:
        return list(ts.execute(
            select(QuestGroupMember).where(
                QuestGroupMember.quest_group_id == group_id,
                QuestGroupMember.removed_at.is_(None),
            )
        ).scalars())


def test_b_tc_069_worker_applies_memberships(client, factory, qg):
    """B-TC-069 payload の memberships を users 生成の後に quest_group_members へ適用（FK順・B.5 step3）。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    gid = qg.make_group(company.db_identifier)
    _enqueue(acc["id"], company.id, {
        "display_name": "Seed Test",
        "memberships": [{"group_id": str(gid), "role": "admin"}],
    })

    process_outbox_once()

    members = _active_members(company.db_identifier, gid)
    assert len(members) == 1
    assert members[0].role == "admin"
    with get_tenant_session(company.db_identifier) as ts:  # user が先に生成され、所属が張れている
        user = get_user_by_account(ts, acc["id"])
    assert user is not None and members[0].user_id == user.id
    assert all(r.status == "done" for r in _outbox_for(acc["id"]))


def test_b_tc_070_worker_memberships_idempotent(client, factory, qg):
    """B-TC-070 同一 memberships payload を2回適用しても有効所属は1行（冪等）。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    gid = qg.make_group(company.db_identifier)
    payload = {"display_name": "Seed Test", "memberships": [{"group_id": str(gid), "role": "member"}]}
    _enqueue(acc["id"], company.id, payload)
    _enqueue(acc["id"], company.id, payload)

    process_outbox_once()

    assert len(_active_members(company.db_identifier, gid)) == 1


def test_b_tc_071_worker_without_memberships_noop(client, factory, qg):
    """B-TC-071 memberships を含まない payload は quest_group_members に触れない（回帰保護・前方互換）。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    gid = qg.make_group(company.db_identifier)
    _enqueue(acc["id"], company.id, {"password_set": True})

    process_outbox_once()

    assert _active_members(company.db_identifier, gid) == []
    assert _user_password_set(company.db_identifier, acc["id"]) is True  # users ミラーは従来どおり


def get_user_by_account_id(db_identifier: str, account_id):
    with get_tenant_session(db_identifier) as ts:
        return get_user_by_account(ts, account_id).id


def _seed_membership(db_identifier: str, group_id, user_id, role="member") -> None:
    with get_tenant_session(db_identifier) as ts:
        ts.add(QuestGroupMember(id=uuid.uuid4(), quest_group_id=group_id, user_id=user_id, role=role))
        ts.commit()


def _active_for(db_identifier: str, group_id, user_id) -> QuestGroupMember | None:
    with get_tenant_session(db_identifier) as ts:
        return ts.execute(
            select(QuestGroupMember).where(
                QuestGroupMember.quest_group_id == group_id,
                QuestGroupMember.user_id == user_id,
                QuestGroupMember.removed_at.is_(None),
            )
        ).scalars().first()


def test_b_tc_096_worker_preserves_existing_members_when_payload_omits(client, factory, qg):
    """B-TC-096 既存の有効所属あり＋memberships 無し payload は既存を保持（削除ではない・加算専用）。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    gid = qg.make_group(company.db_identifier)
    uid = get_user_by_account_id(company.db_identifier, acc["id"])
    _seed_membership(company.db_identifier, gid, uid, "member")

    _enqueue(acc["id"], company.id, {"display_name": "更新名"})  # memberships 無し
    process_outbox_once()

    assert _active_for(company.db_identifier, gid, uid) is not None  # 既存所属は保持（削除されない）


def test_b_tc_097_worker_is_additive_no_removal(client, factory, qg):
    """B-TC-097 ワーカは加算専用＝payload に無い所属は削除しない・一致は role 更新・新規は作成（§4.6）。"""
    acc = factory.make_seed_company_account()
    company = _seed_company_row()
    g1 = qg.make_group(company.db_identifier)
    g2 = qg.make_group(company.db_identifier)
    g3 = qg.make_group(company.db_identifier)
    uid = get_user_by_account_id(company.db_identifier, acc["id"])
    _seed_membership(company.db_identifier, g1, uid, "member")
    _seed_membership(company.db_identifier, g2, uid, "member")

    # payload＝G1(admin)＋G3(member)。G2 は含めない（＝部分集合・修正のつもりでも削除されない）
    _enqueue(acc["id"], company.id, {"display_name": "x", "memberships": [
        {"group_id": str(g1), "role": "admin"}, {"group_id": str(g3), "role": "member"},
    ]})
    process_outbox_once()

    m1 = _active_for(company.db_identifier, g1, uid)
    m2 = _active_for(company.db_identifier, g2, uid)
    m3 = _active_for(company.db_identifier, g3, uid)
    assert m1 is not None and m1.role == "admin"   # 既存 G1 は role 更新（upsert）
    assert m2 is not None                          # payload に無い G2 は削除されない（加算専用）
    assert m3 is not None                          # 新規 G3 は作成

