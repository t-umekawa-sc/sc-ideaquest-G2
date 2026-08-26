"""SEC-TC-001〜040: 横断セキュリティ（応答ヘッダ・アップロード signature/size・cross-tenant・機密ログ非出力）。

監査（2026-08-26）で「実装はあるがテスト漏れ」「実装追加が必要」と判定した横断対策を補完する
（doc/テスト/セキュリティ横断.md）。ドメイン内で完結する対策は各ドメイン md/テストが正。
"""
from __future__ import annotations

import uuid

from app.control_plane.audit.orm import SystemAuditLog
from app.control_plane.auth.orm import Company
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.notifications import service as notify_svc
from app.tenant.profile.repository import get_user_by_account
from tests.admin.test_admin_accounts import _login
from tests.conftest import SEED_COMPANY_CODE, SEED_MFA_COMPANY_CODE

PNG = bytes.fromhex(  # 有効な PNG シグネチャ（\x89PNG…）
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000154a24f0e0000000049454e44ae426082"
)
AVATAR = "/api/v1/me/avatar-image"


def _csrf(client) -> dict:
    return {"X-CSRF-Token": client.cookies.get("iq_csrf")}


def _db(company_code: str) -> str:
    with control_session() as s:
        return s.query(Company).filter_by(company_code=company_code).one().db_identifier


# --- 1. セキュリティ応答ヘッダ（§10） ---------------------------------------------------

def test_sec_tc_001_security_response_headers(client):
    """SEC-TC-001 全応答にセキュリティヘッダ（nosniff/X-Frame/Referrer-Policy/CSP frame-ancestors）。"""
    h = client.get("/healthz").headers
    assert h.get("x-content-type-options") == "nosniff"
    assert h.get("x-frame-options") == "DENY"
    assert h.get("referrer-policy") == "no-referrer"
    assert "frame-ancestors 'none'" in (h.get("content-security-policy") or "")


def test_sec_tc_002_hsts_only_over_tls(client):
    """SEC-TC-002 HSTS は TLS 環境（cookie_secure）のみ＝dev（既定 false）では付与しない。"""
    assert "strict-transport-security" not in {k.lower() for k in client.get("/healthz").headers}


# --- 2. アップロード signature / size（§8） --------------------------------------------

def test_sec_tc_010_image_signature_mismatch(client, factory):
    """SEC-TC-010 image/png 宣言だが中身が非PNG→422 signature_mismatch（MIME 偽装拒否）。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    r = client.put(AVATAR, files={"file": ("a.png", b"this is not a png", "image/png")}, headers=_csrf(client))
    assert r.status_code == 422, r.text
    assert any(e.get("code") == "signature_mismatch" for e in r.json().get("errors", []))


def test_sec_tc_012_image_size_limit(client, factory):
    """SEC-TC-012 画像サイズ上限（>5MB）→422（既存実装のテスト補完）。"""
    acc = factory.make_seed_company_account()
    _login(client, SEED_COMPANY_CODE, acc["login_id"], acc["password"])
    big = PNG + b"0" * (5 * 1024 * 1024 + 1)  # 有効シグネチャ＋上限超
    r = client.put(AVATAR, files={"file": ("a.png", big, "image/png")}, headers=_csrf(client))
    assert r.status_code == 422, r.text


# --- 3. クロステナント遮断（§1.5・会社別DB） ------------------------------------------

def test_sec_tc_020_cross_tenant_notification_404(client, factory):
    """SEC-TC-020 他社（ACME-02）の通知 id は自社（ACME-01）セッションから見えない＝404。"""
    a = factory.make_seed_company_account()          # 会社A（ACME-01）
    b = factory.make_seed_mfa_account()              # 会社B（ACME-02）
    # 会社B の DB に B 宛の通知を1件作る。
    with get_tenant_session(_db(SEED_MFA_COMPANY_CODE)) as ts:
        b_uid = get_user_by_account(ts, b["id"]).id
        created = notify_svc.notify(ts, [notify_svc.entry(b_uid, "mention", params={"actor_name": "X"})])
        ts.commit()
        b_notif_id = created[0].id
    _login(client, SEED_COMPANY_CODE, a["login_id"], a["password"])   # 会社A でログイン
    r = client.post(f"/api/v1/notifications/{b_notif_id}/read", headers=_csrf(client))
    assert r.status_code == 404  # A のDBに B の行は存在しない（会社別DB＝構造的遮断）


# --- 4. 機密のログ非出力（§15） --------------------------------------------------------

def test_sec_tc_030_audit_detail_has_no_secret(client, factory):
    """SEC-TC-030 PW 設定完了の監査 detail に PW/トークンを含めない（company_id/account_id のみ）。"""
    acc = factory.make_seed_company_account(password_set=False)
    token = factory.make_password_setup_challenge(acc["id"])
    r = client.post("/api/v1/auth/password-setup/complete", json={"token": token, "new_password": "Passw0rd!x"})
    assert r.status_code == 200, r.text
    with control_session() as s:
        rows = s.query(SystemAuditLog).filter_by(action="auth.password_changed").all()
        details = [str(row.detail) for row in rows]
    assert details, "監査行が無い"
    blob = " ".join(details)
    assert token not in blob and "Passw0rd!x" not in blob  # 秘匿値（トークン/新PW）は detail に出さない
