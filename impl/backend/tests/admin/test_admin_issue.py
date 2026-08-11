"""アカウント発行 API のテスト（doc/テスト/B_会社・アカウント.md §2・API設計 B.2/B.5）。

`POST /admin/companies/{company_id}/accounts`（system_admin）＝B.5 発行フロー:
accounts INSERT（password_set=false）＋同一Tx で account_sync_outbox（users ミラー）と
mail_outbox（password-setup リンク・非同期）。identity 重複は 409。
発行アカウントは factory 管理外のため `issued` フィクスチャで掃除する。
"""
from __future__ import annotations

import uuid

import pytest

from app.control_plane.account_sync.application import process_outbox_once
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account, Company, OtpChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.orm import User
from tests.admin.test_admin_accounts import _login, _login_system_admin
from tests.conftest import SEED_COMPANY_CODE

SEED_LOGIN = "user@acme.example"


def _company(code: str):
    with control_session() as s:
        c = s.query(Company).filter_by(company_code=code).one()
        return c.id, c.db_identifier


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _ident() -> dict:
    u = uuid.uuid4().hex[:8]
    return {"display_name": f"New {u}", "login_id": f"new-{u}@acme.example", "email": f"new-{u}@acme.example"}


def _url(company_id) -> str:
    return f"/api/v1/admin/companies/{company_id}/accounts"


@pytest.fixture
def issued():
    """発行された account_id を追跡し teardown で掃除（outbox/mail/challenge を account 削除前に）。"""
    ids: list = []
    yield ids
    _, db_id = _company(SEED_COMPANY_CODE)
    with control_session() as s:
        for aid in ids:
            s.query(OutboxEntry).filter_by(account_id=aid).delete()
            s.query(MailOutboxEntry).filter_by(account_id=aid).delete()
            s.query(OtpChallenge).filter_by(account_id=aid).delete()
            s.query(Account).filter_by(id=aid).delete()
        s.commit()
    with get_tenant_session(db_id) as ts:
        for aid in ids:
            ts.query(User).filter_by(account_id=aid).delete()
        ts.commit()


def test_b_tc_020_issue_account_full_flow(client, issued):
    """B-TC-020 発行＝201＋accounts INSERT（password_set=false）＋outbox/mail enqueue→worker で users 生成。根拠 B.2/B.5。"""
    _login_system_admin(client)
    cid, db_id = _company(SEED_COMPANY_CODE)
    ident = _ident()

    r = client.post(_url(cid), json=ident, headers=_csrf(client))

    assert r.status_code == 201, r.text
    body = r.json()
    aid = uuid.UUID(body["account_id"])
    issued.append(aid)
    assert body["status"] == "active" and body["password_set"] is False
    assert body["login_id"] == ident["login_id"] and "password_hash" not in body

    # 同一Tx で account_sync（users ミラー）と mail_outbox（password_setup）が積まれている
    with control_session() as s:
        outbox = s.query(OutboxEntry).filter_by(account_id=aid).all()
        mail = s.query(MailOutboxEntry).filter_by(account_id=aid).all()
        acct = s.query(Account).filter_by(id=aid).one()
    assert len(outbox) == 1 and outbox[0].op == "upsert"
    assert len(mail) == 1 and mail[0].category == "password_setup" and mail[0].secret
    assert acct.password_hash is None  # 初回未設定

    process_outbox_once()  # 会社DB へミラー → users 行生成
    with get_tenant_session(db_id) as ts:
        user = ts.query(User).filter_by(account_id=aid).one_or_none()
    assert user is not None and user.display_name == ident["display_name"]


def test_b_tc_021_duplicate_identity_conflict(client):
    """B-TC-021 会社内で login_id/email 重複は 409 conflict（field 明示）。根拠 B.2。"""
    _login_system_admin(client)
    cid, _ = _company(SEED_COMPANY_CODE)

    # login_id 重複（seed の user@acme.example）
    dup_login = {"display_name": "Dup", "login_id": SEED_LOGIN, "email": _ident()["email"]}
    r1 = client.post(_url(cid), json=dup_login, headers=_csrf(client))
    assert r1.status_code == 409 and r1.json()["code"] == "conflict"
    assert r1.json()["errors"][0]["field"] == "login_id"

    # email 重複（seed の user@acme.example）
    dup_email = {"display_name": "Dup", "login_id": _ident()["login_id"], "email": SEED_LOGIN}
    r2 = client.post(_url(cid), json=dup_email, headers=_csrf(client))
    assert r2.status_code == 409 and r2.json()["errors"][0]["field"] == "email"


def test_b_tc_022_authz_session_and_role(client, factory):
    """B-TC-022 発行は system_admin 専用＝未認証 401／general 403（B.0.1 P1/P6）。"""
    cid, _ = _company(SEED_COMPANY_CODE)
    # セッション無し
    r1 = client.post(_url(cid), json=_ident())
    assert r1.status_code == 401 and r1.json()["code"] == "unauthenticated"
    # general
    acc = factory.make_seed_company_account()
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    r2 = client.post(_url(cid), json=_ident(), headers=_csrf(client))
    assert r2.status_code == 403 and r2.json()["code"] == "forbidden"


def test_b_tc_023_csrf_required(client):
    """B-TC-023 発行（変更系）は CSRF 必須＝トークン無しは 403 csrf_failed（B.0.1 P3）。"""
    _login_system_admin(client)
    cid, _ = _company(SEED_COMPANY_CODE)
    r = client.post(_url(cid), json=_ident())  # X-CSRF-Token 無し
    assert r.status_code == 403 and r.json()["code"] == "csrf_failed"


def test_b_tc_024_validation(client):
    """B-TC-024 不明会社は 404／不正 system_role・想定外プロパティは 422（Mass Assignment 防止）。根拠 B.2/§B.6。"""
    _login_system_admin(client)
    cid, _ = _company(SEED_COMPANY_CODE)

    # 不明会社
    r1 = client.post(_url(uuid.uuid4()), json=_ident(), headers=_csrf(client))
    assert r1.status_code == 404 and r1.json()["code"] == "not_found"
    # 不正 system_role（quest_group_admin は不受理）
    bad_role = {**_ident(), "system_role": "quest_group_admin"}
    r2 = client.post(_url(cid), json=bad_role, headers=_csrf(client))
    assert r2.status_code == 422
    # 想定外プロパティ（extra=forbid）
    extra = {**_ident(), "is_admin": True}
    r3 = client.post(_url(cid), json=extra, headers=_csrf(client))
    assert r3.status_code == 422
