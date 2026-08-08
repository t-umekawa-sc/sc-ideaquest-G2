"""ログインのレート制限（ADR-0001 §2.6・(IP+login_id) 単位）。

Redis の固定窓カウンタ。窓内で上限を超えたら 429。総当りの一次抑止（ベースライン防御）。
アカウント一時ロックは MFA スライスで別途（ADR-0001 §2.6）。
"""
from __future__ import annotations

import redis

from app.core.config import get_settings
from app.core.errors import AppError


def check_login_rate_limit(r: redis.Redis, ip: str, login_id: str) -> None:
    s = get_settings()
    key = f"login_fail:{ip}:{login_id}"
    count = r.incr(key)
    if count == 1:
        r.expire(key, s.login_rate_limit_window_seconds)
    if count > s.login_rate_limit_max:
        ttl = r.ttl(key)
        raise AppError(429, "rate_limited", detail=f"retry after {ttl}s")
