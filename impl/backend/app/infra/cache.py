"""Redis クライアント（セッション/OTP/冪等キー/Pub-Sub 等の基盤・§1.14）。"""
from __future__ import annotations

import redis

from app.core.config import get_settings

_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _client
