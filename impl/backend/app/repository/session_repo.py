"""Redis 上の不透明セッション（ADR-0001 §2.2）。

キー＝`sess:{token}`。値＝A.6 相当の JSON＋`created_at`。
- アイドルTTL＝スライディング（アクセスのたびに延長）。
- 絶対TTL＝`created_at` から一定時間で失効（延長しても超えたら破棄）。
"""
from __future__ import annotations

import json
import time

import redis

from app.core.config import get_settings
from app.core.security import generate_token

_PREFIX = "sess:"


def _key(token: str) -> str:
    return f"{_PREFIX}{token}"


def create_session(r: redis.Redis, payload: dict) -> str:
    """新しいセッションを作成しトークンを返す。認証成功のたびに新トークン（固定化対策・A.0）。"""
    s = get_settings()
    token = generate_token()
    data = {**payload, "created_at": int(time.time())}
    r.set(_key(token), json.dumps(data), ex=s.session_idle_ttl_seconds)
    return token


def get_session(r: redis.Redis, token: str) -> dict | None:
    """セッションを取得。絶対TTL 超過なら破棄して None。生存ならアイドルTTLを延長。"""
    s = get_settings()
    raw = r.get(_key(token))
    if raw is None:
        return None
    data = json.loads(raw)
    if int(time.time()) - int(data.get("created_at", 0)) > s.session_absolute_ttl_seconds:
        r.delete(_key(token))
        return None
    r.expire(_key(token), s.session_idle_ttl_seconds)  # スライディング延長
    return data


def delete_session(r: redis.Redis, token: str) -> None:
    r.delete(_key(token))
