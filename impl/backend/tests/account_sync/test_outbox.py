"""account_sync_outbox（管理DB→会社DB users ミラー）のテスト（doc/テスト/B_会社・アカウント.md・§4.6）。

書込側の同一Tx INSERT（B-TC-001）と、常駐ワーカ本体 process_outbox_once の冪等適用/リトライ/順序
（B-TC-002〜005）を int レベルで確認する。ワーカは常駐せず関数を直接呼ぶ。
"""
from __future__ import annotations

import uuid

from app.control_plane.account_sync import repository as sync_repo
from app.control_plane.account_sync.application import process_outbox_once
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Company
from app.core.config import get_settings
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
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
