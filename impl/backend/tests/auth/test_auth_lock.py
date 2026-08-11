"""ドメイン A ログインハードニング＝アカウント一時ロックのテスト（doc/テスト/A_認証.md §5・ADR-0005）。

ロック/失敗計数/通知クールダウンは Redis。ロックは (IP+login_id) 単位（ADR-0005 §2.2）。
IP はテスト側で差し替える（`TestClient(app, client=(ip, port))`）。応答は列挙耐性のため一律 401（§2.3）。
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.infra.cache import get_redis
from app.main import app
from tests.conftest import SEED_COMPANY_CODE

LOGIN = "/api/v1/auth/login"
VERIFY = "/api/v1/auth/mfa/verify"
COMPLETE = "/api/v1/auth/password-setup/complete"

MAX = get_settings().login_lock_max_attempts  # 既定 5（ADR-0005 §2.1）


def _client(ip: str) -> TestClient:
    """指定 IP を request.client.host に持つ TestClient（(IP+login_id) 単位の検証用）。"""
    return TestClient(app, client=(ip, 12345))


def _login(cl: TestClient, acc: dict, password: str):
    return cl.post(
        LOGIN,
        json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": password},
    )


def _fail_n(cl: TestClient, acc: dict, n: int) -> None:
    """誤パスワードで n 回ログインを試みる（各回 401 を確認）。"""
    for _ in range(n):
        r = _login(cl, acc, "WRONG-pw")
        assert r.status_code == 401, r.text


def test_a_tc_071_lock_after_max_failures(client, factory, mail):
    """A-TC-071 (IP+login_id) で MAX 回連続失敗→以後は正PWでも一律401。根拠 ADR-0005 §2.2/§2.3。"""
    acc = factory.make_seed_company_account()
    a = _client("10.0.0.1")
    _fail_n(a, acc, MAX)  # MAX 回目でロック発火
    r = _login(a, acc, acc["password"])  # 正しいPWでもロック中は通らない
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"
    assert r.cookies.get("iq_session") is None


def test_a_tc_072_other_ip_not_affected(client, factory, mail):
    """A-TC-072 ロックは (IP+login_id) 単位＝別 IP は同一 login_id でも非影響。根拠 ADR-0005 §2.2。"""
    acc = factory.make_seed_company_account()
    a = _client("10.0.0.1")
    _fail_n(a, acc, MAX)  # IP=A をロック
    b = _client("10.0.0.2")
    r = _login(b, acc, acc["password"])  # 別 IP=B からは成功する
    assert r.status_code == 200
    assert r.json()["status"] == "authenticated"


def test_a_tc_073_locked_response_is_uniform_401(client, factory, mail):
    """A-TC-073 ロック中も誤資格と同一の 401（残時間/Retry-After を返さない）。根拠 ADR-0005 §2.3。"""
    acc = factory.make_seed_company_account()
    a = _client("10.0.0.1")
    _fail_n(a, acc, MAX)
    r = _login(a, acc, acc["password"])  # ロック中
    assert r.status_code == 401
    body = r.json()
    assert body["code"] == "unauthenticated"
    assert "Retry-After" not in r.headers          # 残時間を漏らさない
    assert "retry_after" not in body
    assert "locked_until" not in body


def test_a_tc_074_success_clears_counter(client, factory):
    """A-TC-074 認証成功で失敗計数（streak）とロックが消える。根拠 ADR-0005 §2.2。"""
    acc = factory.make_seed_company_account()
    ip = "10.0.0.1"
    a = _client(ip)
    r = get_redis()
    streak_key = f"login_fail_streak:{ip}:{acc['login_id']}"
    lock_key = f"login_lock:{ip}:{acc['login_id']}"

    _fail_n(a, acc, MAX - 1)  # ロック直前まで（発火はしない）
    assert r.get(streak_key) is not None            # 失敗が計上されている

    ok = _login(a, acc, acc["password"])            # 成功で解除
    assert ok.status_code == 200
    assert r.get(streak_key) is None                # streak が消える
    assert r.exists(lock_key) == 0                  # lock も無い


def test_a_tc_075_lock_ttl_not_extended(client, factory, mail):
    """A-TC-075 ロック中の追加試行では lock の TTL を延長しない（発火から固定期間）。根拠 ADR-0005 §2.2/§2.5(a)。"""
    acc = factory.make_seed_company_account()
    ip = "10.0.0.1"
    a = _client(ip)
    r = get_redis()
    lock_key = f"login_lock:{ip}:{acc['login_id']}"

    _fail_n(a, acc, MAX)                            # 発火
    ttl1 = r.ttl(lock_key)
    assert ttl1 > 0

    a.post(LOGIN, json={"company_code": acc["company_code"], "login_id": acc["login_id"], "password": "WRONG-pw"})
    _login(a, acc, acc["password"])                 # ロック中の追加試行
    ttl2 = r.ttl(lock_key)
    assert 0 < ttl2 <= ttl1                         # TTL は増えない（減るのみ）


def test_a_tc_076_password_reset_clears_lock(client, factory, mail):
    """A-TC-076 PW 再設定成功でロック即解除→新PWで login 成功。根拠 ADR-0005 §2.5(b)。"""
    acc = factory.make_seed_company_account()
    ip = "10.0.0.1"
    a = _client(ip)
    _fail_n(a, acc, MAX)
    assert _login(a, acc, acc["password"]).status_code == 401   # ロック中（正PWでも401）

    token = factory.make_password_setup_challenge(acc["id"])
    new_pw = "NewPassw0rd1"
    c = a.post(COMPLETE, json={"token": token, "new_password": new_pw})
    assert c.status_code == 200

    r = _login(a, acc, new_pw)                      # ロック解除済み＋新PW
    assert r.status_code == 200
    assert r.json()["status"] == "authenticated"


def test_a_tc_077_lock_notification_once_with_cooldown(client, factory, mail):
    """A-TC-077 ロック発火で本人へ通知1通・クールダウン中は再発火でも追加送信なし。根拠 ADR-0005 §2.4。"""
    acc = factory.make_seed_company_account()
    a = _client("10.0.0.1")
    _fail_n(a, acc, MAX)                            # 発火→通知
    assert len(mail.sent) == 1
    assert mail.sent[0].to == acc["email"]

    b = _client("10.0.0.2")
    _fail_n(b, acc, MAX)                            # 別 (IP+login_id) で再発火
    assert len(mail.sent) == 1                      # クールダウンで追加送信なし


def test_a_tc_078_no_notification_for_unknown_login_id(client, mail):
    """A-TC-078 存在しない login_id はロックされても通知メール無し（実在 active のみ・列挙耐性）。根拠 ADR-0005 §2.4。"""
    ghost = {"company_code": SEED_COMPANY_CODE, "login_id": "ghost@acme.example", "password": "WRONG-pw"}
    a = _client("10.0.0.1")
    for _ in range(MAX):
        assert a.post(LOGIN, json=ghost).status_code == 401
    assert len(mail.sent) == 0                      # 実在しないので通知しない
    assert a.post(LOGIN, json=ghost).status_code == 401  # ロック中も一律 401


def test_a_tc_082_streak_resets_after_window_expiry(client, factory):
    """A-TC-082 失敗計数の固定窓 TTL が経過（キー消滅）すると次の失敗は 1 から数え直す＝累積せずロックも発火しない。根拠 ADR-0005 §2.2/§2.5(a)。"""
    acc = factory.make_seed_company_account()
    ip = "10.0.0.1"
    a = _client(ip)
    r = get_redis()
    streak_key = f"login_fail_streak:{ip}:{acc['login_id']}"
    lock_key = f"login_lock:{ip}:{acc['login_id']}"

    _fail_n(a, acc, MAX - 1)                 # ロック発火の1歩手前まで（4回）
    assert r.get(streak_key) == str(MAX - 1)  # 計数が 4 まで積まれている

    r.delete(streak_key)                     # 固定窓 TTL の経過を再現（延長しない＝発火から固定期間で必ず消える）

    _fail_n(a, acc, 1)                        # 窓経過後の 1 回失敗
    assert r.get(streak_key) == "1"          # 5 の累積ではなく 1 から数え直し
    assert r.exists(lock_key) == 0           # ロックは発火しない（4+1 を 5 と扱わない）


def test_a_tc_079_otp_failure_does_not_lock_login(client, factory, mail):
    """A-TC-079 mfa/verify の OTP 連続失敗は login ロックに非連動。根拠 ADR-0005 §2.6。"""
    acc = factory.make_seed_mfa_account()  # ACME-02（MFA ON）
    r = _login(client, acc, acc["password"])
    assert r.status_code == 200 and r.json()["status"] == "mfa_required"

    csrf = {"X-CSRF-Token": client.cookies.get("iq_csrf")}
    for _ in range(MAX):
        client.post(VERIFY, json={"code": "000000", "trust_device": False}, headers=csrf)

    r2 = _login(client, acc, acc["password"])       # 改めて login
    assert r2.status_code == 200
    assert r2.json()["status"] == "mfa_required"    # ロックの 401 にならない
    assert get_redis().exists(f"login_lock:testclient:{acc['login_id']}") == 0
