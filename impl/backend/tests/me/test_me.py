"""PATCH /me（自己プロフィール編集）のテスト（doc/テスト/K_プロフィール.md §1・API設計 K.2）。

identity は管理DB `accounts` 源泉＝accounts 更新＋同一Tx で account_sync_outbox INSERT→ワーカが会社DB
`users` へミラー（§4.6/§5.3）。allowlist は `display_name`/`locale` のみ（§2.2 Mass Assignment 防止）。
発行アカウント・users ミラー・outbox は factory teardown が掃除する。
"""
from __future__ import annotations

import uuid

from app.control_plane.account_sync.application import process_outbox_once
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account, Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ME = "/api/v1/me"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _db_identifier() -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=SEED_COMPANY_CODE).one().db_identifier


def _account(account_id) -> Account:
    with control_session() as s:
        return s.query(Account).filter_by(id=account_id).one()


def _outbox(account_id) -> list[OutboxEntry]:
    with control_session() as s:
        return list(s.query(OutboxEntry).filter_by(account_id=account_id).order_by(OutboxEntry.seq).all())


def _login_seed(client, factory) -> dict:
    acc = factory.make_seed_company_account()
    _login(client, acc["company_code"], acc["login_id"], acc["password"])
    return acc


def test_k_tc_001_patch_me_updates_and_mirrors(client, factory):
    """K-TC-001 表示名・ロケール編集＝200・accounts 更新＋同一Tx outbox→worker で users ミラー。"""
    acc = _login_seed(client, factory)

    r = client.patch(ME, json={"display_name": "新しい名前", "locale": "en"}, headers=_csrf(client))
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "新しい名前" and r.json()["locale"] == "en"

    a = _account(acc["id"])  # accounts（源泉）更新
    assert a.display_name == "新しい名前" and a.locale == "en"

    # 同一Tx で outbox に upsert 行（ログイン成功の last_login_at 行とは別に、PATCH 由来の 1 行が入る）
    patch_rows = [r for r in _outbox(acc["id"])
                  if r.op == "upsert" and r.payload.get("display_name") == "新しい名前"]
    assert len(patch_rows) == 1 and patch_rows[0].payload.get("locale") == "en"

    process_outbox_once()  # 会社DB users へミラー
    with get_tenant_session(_db_identifier()) as ts:
        u = get_user_by_account(ts, acc["id"])
    assert u.display_name == "新しい名前" and u.locale == "en"


def test_k_tc_002_allowlist_and_locale_validation(client, factory):
    """K-TC-002 allowlist 外は 422（Mass Assignment 防止）・locale は ja|en enum。"""
    _login_seed(client, factory)
    # allowlist 外（system_role/login_id）＝想定外プロパティ拒否
    assert client.patch(ME, json={"display_name": "x", "system_role": "system_admin"},
                        headers=_csrf(client)).status_code == 422
    assert client.patch(ME, json={"login_id": "hax"}, headers=_csrf(client)).status_code == 422
    # locale enum 違反
    assert client.patch(ME, json={"locale": "fr"}, headers=_csrf(client)).status_code == 422


def test_k_tc_003_auth_and_csrf(client, factory):
    """K-TC-003 未認証は 401（先）／ログイン済み CSRF 無しは 403 csrf_failed（変更系・A.0）。"""
    assert client.patch(ME, json={"display_name": "x"}).status_code == 401
    _login_seed(client, factory)
    assert client.patch(ME, json={"display_name": "x"}).status_code == 403  # CSRF 無し


def test_k_tc_004_get_me(client, factory):
    """K-TC-004 GET /me＝ログイン中の identity を返す（機密は返さない）。K.1。"""
    acc = _login_seed(client, factory)
    r = client.get(ME)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["login_id"] == acc["login_id"]
    assert set(body.keys()) == {"login_id", "email", "display_name", "locale", "system_role"}
    assert "password_hash" not in body and "password" not in body


def test_k_tc_005_get_me_requires_session(client):
    """K-TC-005 GET /me はセッション必須＝未認証は 401（B.0.1 P1）。"""
    assert client.get(ME).status_code == 401


def test_k_tc_007_change_password(client, factory):
    """K-TC-007 PW変更＝現在PW再認証／ポリシー／成功で全セッション破棄＋新PWでログイン可（K.3・A.9-③）。"""
    acc = _login_seed(client, factory)
    # 現在PW不一致＝403 reauth_failed（セッションは有効＝401 と区別）
    assert client.post(ME + "/password", json={"current_password": "WRONGpw1", "new_password": "NewPassw0rd1"},
                       headers=_csrf(client)).status_code == 403
    # 新PWがポリシー違反＝422
    assert client.post(ME + "/password", json={"current_password": acc["password"], "new_password": "short"},
                       headers=_csrf(client)).status_code == 422
    # 成功＝204
    r = client.post(ME + "/password", json={"current_password": acc["password"], "new_password": "NewPassw0rd1"},
                    headers=_csrf(client))
    assert r.status_code == 204, r.text
    # 全セッション破棄＝当該セッションで GET /me が 401
    assert client.get(ME).status_code == 401
    # 新PWでログインできる
    _login(client, acc["company_code"], acc["login_id"], "NewPassw0rd1")


def test_k_tc_008_change_email(client, factory):
    """K-TC-008 メール変更＝現在PW再認証／会社内一意（409）／成功で accounts.email 更新＋outbox（K.3）。"""
    acc = _login_seed(client, factory)
    # 現在PW不一致＝403
    assert client.post(ME + "/email", json={"new_email": "x@acme.example", "current_password": "WRONGpw1"},
                       headers=_csrf(client)).status_code == 403
    # 会社内で既存（seed の user@acme.example）と重複＝409
    r_dup = client.post(ME + "/email", json={"new_email": "user@acme.example", "current_password": acc["password"]},
                        headers=_csrf(client))
    assert r_dup.status_code == 409 and r_dup.json()["errors"][0]["field"] == "email"
    # 成功＝200＋email 更新＋outbox（users ミラー）
    newmail = f"changed-{uuid.uuid4().hex[:8]}@acme.example"
    r = client.post(ME + "/email", json={"new_email": newmail, "current_password": acc["password"]},
                    headers=_csrf(client))
    assert r.status_code == 200 and r.json()["email"] == newmail
    assert _account(acc["id"]).email == newmail
    assert any(x.payload.get("email") == newmail for x in _outbox(acc["id"]))
