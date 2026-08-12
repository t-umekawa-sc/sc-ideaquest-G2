"""PATCH /me（自己プロフィール編集）のテスト（doc/テスト/K_プロフィール.md §1・API設計 K.2）。

identity は管理DB `accounts` 源泉＝accounts 更新＋同一Tx で account_sync_outbox INSERT→ワーカが会社DB
`users` へミラー（§4.6/§5.3）。allowlist は `display_name`/`locale` のみ（§2.2 Mass Assignment 防止）。
発行アカウント・users ミラー・outbox は factory teardown が掃除する。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.account_sync.application import process_outbox_once
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth.orm import Account, Company, OtpChallenge
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE

ME = "/api/v1/me"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _mail(account_id) -> list[MailOutboxEntry]:
    with control_session() as s:
        return list(s.query(MailOutboxEntry).filter_by(account_id=account_id).all())


def _email_change_challenge(account_id) -> OtpChallenge | None:
    with control_session() as s:
        return (s.query(OtpChallenge)
                .filter_by(account_id=account_id, purpose="email_change")
                .order_by(OtpChallenge.created_at.desc()).first())


def _email_change_token(account_id) -> str:
    """要求で新メールへ積まれた確認リンクの平文トークン（mail_outbox.secret）を取り出す。"""
    confirm = [m for m in _mail(account_id) if m.category == "email_change_confirm"]
    assert len(confirm) == 1 and confirm[0].secret
    return confirm[0].secret


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


def test_k_tc_008_change_email_request(client, factory):
    """K-TC-008 メール変更要求（ダブルオプトイン）＝再認証／会社内重複409／成功で 202＋pending＋確認/通知メール2通。

    正常でも accounts.email は不変・pending_email に格納・account_sync に email 行は積まれない（確定時まで）。
    根拠 K.3／ADR-0008／§4.2。
    """
    acc = _login_seed(client, factory)
    old_email = _account(acc["id"]).email
    # 現在PW不一致＝403（再認証失敗）
    assert client.post(ME + "/email", json={"new_email": "x@acme.example", "current_password": "WRONGpw1"},
                       headers=_csrf(client)).status_code == 403
    # 会社内で既存（seed の user@acme.example）と重複＝409（要求時に確定 email で検証）
    r_dup = client.post(ME + "/email", json={"new_email": "user@acme.example", "current_password": acc["password"]},
                        headers=_csrf(client))
    assert r_dup.status_code == 409 and r_dup.json()["errors"][0]["field"] == "email"
    # 成功＝202（確定待ち）
    newmail = f"changed-{uuid.uuid4().hex[:8]}@acme.example"
    r = client.post(ME + "/email", json={"new_email": newmail, "current_password": acc["password"]},
                    headers=_csrf(client))
    assert r.status_code == 202, r.text
    # accounts.email は不変・pending_email に新メール
    a = _account(acc["id"])
    assert a.email == old_email and a.pending_email == newmail
    # email_change チャレンジが1件（未使用）
    ch = _email_change_challenge(acc["id"])
    assert ch is not None and ch.used_at is None
    # mail_outbox に確認（新宛・secret 有）＋通知（旧宛・secret 無）の2通
    mails = _mail(acc["id"])
    confirm = [m for m in mails if m.category == "email_change_confirm"]
    notice = [m for m in mails if m.category == "email_change_notice"]
    assert len(confirm) == 1 and confirm[0].to_email == newmail and confirm[0].secret
    assert len(notice) == 1 and notice[0].to_email == old_email
    # account_sync には email ミラー行が積まれていない（確定時まで）
    assert not any(x.payload.get("email") == newmail for x in _outbox(acc["id"]))


def test_k_tc_010_confirm_email_change(client, factory):
    """K-TC-010 確定＝正常で email が pending へ確定・単回消費・mirror enqueue／無効・使用済みトークン 410（K.3／ADR-0008）。"""
    acc = _login_seed(client, factory)
    newmail = f"confirmed-{uuid.uuid4().hex[:8]}@acme.example"
    assert client.post(ME + "/email", json={"new_email": newmail, "current_password": acc["password"]},
                       headers=_csrf(client)).status_code == 202
    token = _email_change_token(acc["id"])

    # 無効トークン＝410
    assert client.post(ME + "/email/confirm", json={"token": "bogus-" + uuid.uuid4().hex}).status_code == 410

    # 正常確定＝200＋accounts.email 確定・pending クリア・チャレンジ単回消費・mirror enqueue
    r = client.post(ME + "/email/confirm", json={"token": token})
    assert r.status_code == 200, r.text
    a = _account(acc["id"])
    assert a.email == newmail and a.pending_email is None
    assert _email_change_challenge(acc["id"]).used_at is not None
    assert any(x.op == "upsert" and x.payload.get("email") == newmail for x in _outbox(acc["id"]))

    # 会社DB users へミラー反映
    process_outbox_once()
    with get_tenant_session(_db_identifier()) as ts:
        u = get_user_by_account(ts, acc["id"])
    assert u.email == newmail

    # 使用済みトークンの再確定＝410（単回）
    assert client.post(ME + "/email/confirm", json={"token": token}).status_code == 410


def test_k_tc_010_confirm_expired(client, factory):
    """K-TC-010 期限切れトークンでの確定＝410（K.3／ADR-0008）。"""
    acc = _login_seed(client, factory)
    newmail = f"expired-{uuid.uuid4().hex[:8]}@acme.example"
    assert client.post(ME + "/email", json={"new_email": newmail, "current_password": acc["password"]},
                       headers=_csrf(client)).status_code == 202
    token = _email_change_token(acc["id"])
    # チャレンジを期限切れに直接改変
    with control_session() as s:
        ch = s.query(OtpChallenge).filter_by(account_id=acc["id"], purpose="email_change").one()
        ch.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        s.commit()
    assert client.post(ME + "/email/confirm", json={"token": token}).status_code == 410
    # email は変わらず・pending は残る（別途やり直し）
    assert _account(acc["id"]).email != newmail


def test_k_tc_010_confirm_conflict(client, factory):
    """K-TC-010 確定時の会社内衝突（TOCTOU）＝409／pending はクリア（K.3／ADR-0008）。"""
    acc = _login_seed(client, factory)
    clashmail = f"clash-{uuid.uuid4().hex[:8]}@acme.example"
    assert client.post(ME + "/email", json={"new_email": clashmail, "current_password": acc["password"]},
                       headers=_csrf(client)).status_code == 202
    token = _email_change_token(acc["id"])
    # 要求〜確定の間に別アカウントが同 email を確定（同一会社）
    other = factory.make_seed_company_account()
    with control_session() as s:
        s.query(Account).filter_by(id=other["id"]).update({"email": clashmail})
        s.commit()
    r = client.post(ME + "/email/confirm", json={"token": token})
    assert r.status_code == 409 and r.json()["errors"][0]["field"] == "email"
    # pending はクリア（やり直しを促す）・email は不変
    a = _account(acc["id"])
    assert a.email != clashmail and a.pending_email is None
