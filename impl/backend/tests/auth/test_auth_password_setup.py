"""状態B・D＝初回・再設定パスワード（doc/テスト/A_認証.md §3・A-TC-030〜051）。

仕様の正＝doc/API設計/A_認証・セッション.md A.7／A.9-③⑤・doc/ADR/ADR-0002。
3EP＝POST /api/v1/auth/password-setup/{request,verify,complete}。
メール送信は `mail` フィクスチャ（フェイク）で捕捉する。
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from app.control_plane.auth import repository as account_repo
from app.control_plane.auth.domain.service import password_policy_errors
from app.control_plane.auth.orm import TrustedDevice
from app.db.control import control_session


def _add_trusted_device(account_id) -> None:
    """当該アカウントに有効な信頼端末を1件作る（A.9-③ 失効検証の下地）。"""
    with control_session() as s:
        account_repo.create_trusted_device(
            s, account_id, f"hash-{uuid.uuid4().hex}", datetime.now(timezone.utc) + timedelta(days=30)
        )
        s.commit()


def _all_trusted_revoked(account_id) -> bool:
    with control_session() as s:
        rows = s.query(TrustedDevice).filter_by(account_id=account_id).all()
    return len(rows) > 0 and all(r.revoked for r in rows)


REQUEST = "/api/v1/auth/password-setup/request"
VERIFY = "/api/v1/auth/password-setup/verify"
COMPLETE = "/api/v1/auth/password-setup/complete"
LOGIN = "/api/v1/auth/login"
SESSION = "/api/v1/auth/session"

GOOD_PW = "NewPassw0rd"  # 8文字以上＋英字＋数字（ADR-0002 §2.2）


def _token_from_mail(sent_mail) -> str:
    m = re.search(r"token=(\S+)", sent_mail.body)
    assert m, "メール本文に設定リンクの token が含まれること"
    return m.group(1)


# --- 3.1 request（状態D・常に 202） -----------------------------------------------------
def test_a_tc_030_request_active_account_sends_mail(client, factory, mail):
    """A-TC-030 active 会社＋active アカウント→202＋メール送信あり（リンクに token）。"""
    acc = factory.make_seed_company_account()
    res = client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
    assert res.status_code == 202
    assert res.json()["status"] == "accepted"
    assert len(mail.sent) == 1
    assert _token_from_mail(mail.sent[0])


def test_a_tc_031_request_unknown_login_same_response_no_mail(client, factory, mail):
    """A-TC-031 存在しない login_id→202（030 と同一）・送信なし（列挙耐性）。"""
    res = client.post(REQUEST, json={"company_code": "ACME-01", "login_id": "nobody@acme.example"})
    assert res.status_code == 202
    assert res.json()["status"] == "accepted"
    assert mail.sent == []


def test_a_tc_032_request_unknown_company_same_response_no_mail(client, mail):
    """A-TC-032 存在しない company_code→202（同一）・送信なし。"""
    res = client.post(REQUEST, json={"company_code": "NO-SUCH-CO", "login_id": "user@acme.example"})
    assert res.status_code == 202
    assert mail.sent == []


def test_a_tc_033_request_password_unset_account_sends_mail(client, factory, mail):
    """A-TC-033 初回未設定（password_set=false）でも active なら送信（同じリンク基盤）。"""
    acc = factory.make_seed_company_account(password_set=False)
    res = client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
    assert res.status_code == 202
    assert len(mail.sent) == 1


def test_a_tc_034_request_disabled_account_no_mail(client, factory, mail):
    """A-TC-034 disabled アカウント→202・送信なし（active のみ実送信）。"""
    acc = factory.make_seed_company_account(status="disabled")
    res = client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
    assert res.status_code == 202
    assert mail.sent == []


def test_a_tc_035_request_suspended_company_no_mail(client, factory, mail):
    """A-TC-035 suspended 会社→202・送信なし。"""
    co = factory.make_company(status="suspended")
    acc = factory.make_account(co)
    res = client.post(REQUEST, json={"company_code": co["company_code"], "login_id": acc["login_id"]})
    assert res.status_code == 202
    assert mail.sent == []


def test_a_tc_036_request_without_csrf_ok(client, factory, mail):
    """A-TC-036 CSRF トークン無しでも成功（CSRF 免除・Origin のみ・A.7）。"""
    acc = factory.make_seed_company_account()
    res = client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
    assert res.status_code == 202  # X-CSRF-Token を付けていない


def test_a_tc_037_request_bad_origin_rejected(client, factory, mail):
    """A-TC-037 不正 Origin→403（Origin/Sec-Fetch 検証）。"""
    acc = factory.make_seed_company_account()
    res = client.post(
        REQUEST,
        json={"company_code": acc["company_code"], "login_id": acc["login_id"]},
        headers={"origin": "https://evil.example"},
    )
    assert res.status_code == 403
    assert res.json()["code"] == "forbidden"


def test_a_tc_038_request_rate_limited_still_202_but_suppressed(client, factory, mail):
    """A-TC-038 6回連続→すべて 202・送信は上限（5回/10分）まで（超過を漏らさない）。"""
    acc = factory.make_seed_company_account()
    for _ in range(6):
        res = client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
        assert res.status_code == 202
    # 自分の宛先だけを数える（グローバル mail.sent の他テスト行に依存しない・順序依存フラキー回避）。
    assert len([m for m in mail.sent if m.to == acc["email"]]) == 5  # 6回目以降は無送信


def test_a_tc_039_request_missing_field_422(client):
    """A-TC-039 login_id 欠落→422 validation_error。"""
    res = client.post(REQUEST, json={"company_code": "ACME-01"})
    assert res.status_code == 422
    assert res.json()["code"] == "validation_error"


def test_a_tc_040_request_invalidates_previous_challenge(client, factory, mail):
    """A-TC-040 再要求で旧トークン失効・最新のみ有効（int 相当）。"""
    acc = factory.make_seed_company_account()
    client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
    client.post(REQUEST, json={"company_code": acc["company_code"], "login_id": acc["login_id"]})
    mine = [m for m in mail.sent if m.to == acc["email"]]  # 自分宛のみ（グローバル依存回避）
    old_token = _token_from_mail(mine[0])
    new_token = _token_from_mail(mine[1])
    assert client.post(VERIFY, json={"token": old_token}).status_code == 410  # 失効
    assert client.post(VERIFY, json={"token": new_token}).status_code == 200  # 最新のみ有効


# --- 3.2 verify -----------------------------------------------------------------------
def test_a_tc_041_verify_valid_token(client, factory):
    """A-TC-041 有効トークン→200 {valid:true, login_id}。"""
    acc = factory.make_seed_company_account()
    token = factory.make_password_setup_challenge(acc["id"])
    res = client.post(VERIFY, json={"token": token})
    assert res.status_code == 200
    body = res.json()
    assert body["valid"] is True
    assert body["login_id"] == acc["login_id"]


def test_a_tc_042_verify_unknown_token_410(client):
    """A-TC-042 未知トークン→410 token_expired。"""
    res = client.post(VERIFY, json={"token": "does-not-exist"})
    assert res.status_code == 410
    assert res.json()["code"] == "token_expired"


def test_a_tc_043_verify_expired_token_410(client, factory):
    """A-TC-043 期限切れ（72h 超）トークン→410（int 相当）。"""
    acc = factory.make_seed_company_account()
    token = factory.make_password_setup_challenge(acc["id"], expires_in_seconds=-10)
    res = client.post(VERIFY, json={"token": token})
    assert res.status_code == 410
    assert res.json()["code"] == "token_expired"


def test_a_tc_044_verify_used_token_410(client, factory):
    """A-TC-044 使用済みトークン→410（単回）。"""
    acc = factory.make_seed_company_account()
    token = factory.make_password_setup_challenge(acc["id"], used=True)
    res = client.post(VERIFY, json={"token": token})
    assert res.status_code == 410


# --- 3.3 complete ---------------------------------------------------------------------
def test_a_tc_045_complete_sets_password_and_login_works(client, factory, mail):
    """A-TC-045 適合PWで complete→200・その新PWで login 成功。"""
    acc = factory.make_seed_company_account(password_set=False)
    token = factory.make_password_setup_challenge(acc["id"])
    res = client.post(COMPLETE, json={"token": token, "new_password": GOOD_PW})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    # 新PWで login が成功する（password_set=true・会社DB users ミラーあり）
    login = client.post(LOGIN, json={
        "company_code": acc["company_code"], "login_id": acc["login_id"], "password": GOOD_PW,
    })
    assert login.status_code == 200
    assert login.json()["status"] == "authenticated"


def test_a_tc_046_complete_policy_violation_422(client, factory):
    """A-TC-046 ポリシー違反PW→422 errors[]（PW は変更されない）。"""
    acc = factory.make_seed_company_account(password_set=False)
    token = factory.make_password_setup_challenge(acc["id"])
    res = client.post(COMPLETE, json={"token": token, "new_password": "short"})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "validation_error"
    assert len(body["errors"]) >= 1
    # PW 未設定のままなので、その値で login はできない（未設定＝一律 401）
    login = client.post(LOGIN, json={
        "company_code": acc["company_code"], "login_id": acc["login_id"], "password": "short",
    })
    assert login.status_code == 401


def test_a_tc_047_complete_invalid_token_410(client, factory):
    """A-TC-047 無効トークン＋適合PW→410（PW 変更なし）。"""
    res = client.post(COMPLETE, json={"token": "nope", "new_password": GOOD_PW})
    assert res.status_code == 410
    assert res.json()["code"] == "token_expired"


def test_a_tc_048_complete_is_single_use(client, factory):
    """A-TC-048 complete 成功後、同一トークンで再度→410（単回消費）。"""
    acc = factory.make_seed_company_account(password_set=False)
    token = factory.make_password_setup_challenge(acc["id"])
    assert client.post(COMPLETE, json={"token": token, "new_password": GOOD_PW}).status_code == 200
    again = client.post(COMPLETE, json={"token": token, "new_password": GOOD_PW})
    assert again.status_code == 410


def test_a_tc_049_complete_destroys_existing_sessions(client, factory):
    """A-TC-049 別途ログイン中に complete 成功→そのセッション破棄（401）＋信頼端末失効（A.9-③・A.7）。"""
    acc = factory.make_seed_company_account()  # password_set=True・既知PW
    _add_trusted_device(acc["id"])  # 有効な信頼端末を1件（PW再設定で失効すべき）
    login = client.post(LOGIN, json={
        "company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"],
    })
    assert login.status_code == 200
    assert client.get(SESSION).status_code == 200  # ログイン中（Cookie 保持）

    token = factory.make_password_setup_challenge(acc["id"])
    assert client.post(COMPLETE, json={"token": token, "new_password": GOOD_PW}).status_code == 200
    # 既存セッションは破棄されている
    assert client.get(SESSION).status_code == 401
    # 信頼端末も失効している（A.7/A.9-③＝PW再設定で全端末リセット・盗難端末の MFA スキップ継続を防ぐ）
    assert _all_trusted_revoked(acc["id"])


# --- 3.4 PW ポリシー（domain 純粋関数・DB 非依存） -----------------------------------------
def test_a_tc_051_password_policy_pure_function():
    """A-TC-051 PWポリシー判定＝適合は空・各違反は対応 errors（ADR-0002 §2.2）。"""
    assert password_policy_errors("NewPassw0rd") == []  # 適合
    codes = lambda pw: {e["code"] for e in password_policy_errors(pw)}
    assert "too_short" in codes("Ab1")          # 7文字未満
    assert "missing_digit" in codes("Password")  # 数字なし
    assert "missing_letter" in codes("12345678")  # 英字なし
