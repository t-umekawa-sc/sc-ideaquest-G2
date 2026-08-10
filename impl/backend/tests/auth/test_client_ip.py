"""クライアント IP の確定（信頼プロキシ）のテスト（doc/テスト/A_認証.md §6・ADR-0006）。

resolve_client_ip は純粋関数（core/net.py）＝XFF を右から trusted_proxy_count ホップ分だけ
自陣プロキシとみなし、その 1 つ外側（クライアント側）を実クライアント IP とする。
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.core.net import resolve_client_ip

LOGIN = "/api/v1/auth/login"
MAX = get_settings().login_lock_max_attempts


# --- A-TC-080: 純粋関数 -----------------------------------------------------------------
def test_a_tc_080_resolve_client_ip():
    """A-TC-080 resolve_client_ip の確定規則。根拠 ADR-0006 §2.1/§3。"""
    # count=0＝プロキシ無し＝直近ピアをそのまま
    assert resolve_client_ip("10.0.0.9", None, 0) == "10.0.0.9"
    assert resolve_client_ip("10.0.0.9", "1.2.3.4", 0) == "10.0.0.9"  # count=0 は XFF を見ない

    # count=1＝最外プロキシが実ピアを XFF に付与。chain=[client, peer] の右から1つ外側
    assert resolve_client_ip("proxy1", "203.0.113.9", 1) == "203.0.113.9"

    # count=2＝chain=[client, P1, peer] の右から2つ外側
    assert resolve_client_ip("proxy2", "203.0.113.9, proxy1", 2) == "203.0.113.9"

    # 詐称: クライアントが XFF 先頭に偽値を注入しても、右から数えるため無視される
    #   chain=[fake, clientReal, peer(P1)]・count=1 → clientReal
    assert resolve_client_ip("proxy1", "1.1.1.1, 203.0.113.9", 1) == "203.0.113.9"

    # XFF が想定より短い（設定過大 or 直アクセス）＝安全側で最外（chain[0]）
    assert resolve_client_ip("proxy1", None, 1) == "proxy1"
    assert resolve_client_ip("proxy1", "203.0.113.9", 3) == "203.0.113.9"


# --- A-TC-081: プロキシ経由でロックが実クライアント IP に効く ----------------------------
def test_a_tc_081_lock_keys_on_real_client_ip_behind_proxy(client, factory, mail, monkeypatch):
    """A-TC-081 XFF の異なる2クライアントはロックが分離する（プロキシ IP に潰れない）。根拠 ADR-0006 §2.1・ADR-0005 §2.2。"""
    monkeypatch.setenv("TRUSTED_PROXY_COUNT", "1")
    get_settings.cache_clear()
    try:
        acc = factory.make_seed_company_account()
        body_wrong = {"company_code": acc["company_code"], "login_id": acc["login_id"], "password": "WRONG-pw"}
        body_ok = {"company_code": acc["company_code"], "login_id": acc["login_id"], "password": acc["password"]}
        hdr_a = {"X-Forwarded-For": "203.0.113.1"}
        hdr_b = {"X-Forwarded-For": "203.0.113.2"}

        for _ in range(MAX):  # クライアント A を発火
            assert client.post(LOGIN, json=body_wrong, headers=hdr_a).status_code == 401

        # A（XFF .1）はロック＝正PWでも 401
        assert client.post(LOGIN, json=body_ok, headers=hdr_a).status_code == 401
        # B（XFF .2）は別クライアント扱い＝成功（ロックがプロキシ IP に潰れていない）
        assert client.post(LOGIN, json=body_ok, headers=hdr_b).status_code == 200
    finally:
        get_settings.cache_clear()
