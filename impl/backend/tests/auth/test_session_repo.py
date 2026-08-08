"""セッションストア/PW照合の統合・単体テスト（int/unit・doc/テスト/A_認証.md）。"""
from __future__ import annotations

import json
import time

from app.core import security
from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.infra.cache import get_redis


def test_a_tc_018_session_store_ttl_and_absolute_expiry():
    """A-TC-018 Redis セッションの保存/取得/TTL＋絶対TTL 超過で破棄。根拠 ADR §2.2。"""
    r = get_redis()
    s = get_settings()
    payload = {"account_id": "acc_x", "company_id": "co_x"}

    token = security.create_session(r, payload)
    key = f"sess:{token}"
    ttl = r.ttl(key)
    assert 0 < ttl <= s.session_idle_ttl_seconds
    got = security.read_session(r, token)
    assert got and got["account_id"] == "acc_x"

    # 絶対TTL 超過を再現: created_at を過去に書き換える → read で破棄され None
    data = json.loads(r.get(key))
    data["created_at"] = int(time.time()) - s.session_absolute_ttl_seconds - 10
    r.set(key, json.dumps(data))
    assert security.read_session(r, token) is None
    assert r.get(key) is None  # 破棄されている

    # delete
    token2 = security.create_session(r, payload)
    security.delete_session(r, token2)
    assert security.read_session(r, token2) is None


def test_a_tc_019_password_verify_no_enumeration_leak():
    """A-TC-019 未設定(None)でも照合は False（早期 return せずダミー照合・時間差はダミーハッシュで構造的に担保）。根拠 ADR §2.5。"""
    h = hash_password("Correct1!")
    assert verify_password("Correct1!", h) is True
    assert verify_password("WRONG", h) is False
    assert verify_password("anything", None) is False  # password_set=false
