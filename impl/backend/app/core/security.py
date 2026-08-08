"""セキュリティ基盤（§3.4 core/security.py＝Argon2id・セッション・CSRF）。

- パスワードハッシュ＝Argon2id（m=19MiB, t=2, p=1・OWASP 下限ベースライン・ADR-0001 §2.5）。
- 不透明トークン（セッション/CSRF）＝CSPRNG（A.0）。
- セッションストア＝Redis `sess:{token}`（idle スライディング/絶対上限・ADR-0001 §2.2）。
- ログインのレート制限＝(IP+login_id) 固定窓（ADR-0001 §2.6）。
CSRF ヘッダ一致の検証は core/deps.py（リクエストガード）側で行う。
"""
from __future__ import annotations

import json
import secrets
import time

import redis
from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc

from app.core.config import get_settings
from app.core.errors import AppError

# --- パスワード（Argon2id・ADR §2.5） -------------------------------------------------
_ph = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)
# 存在しないアカウントでもタイミング差を作らないためのダミーハッシュ
_DUMMY_HASH = _ph.hash("x" * 24)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """PW 照合。password_hash が None（未設定）でも必ずダミー照合を行い時間差を作らない。"""
    target = password_hash or _DUMMY_HASH
    try:
        _ph.verify(target, password)
    except (argon2_exc.VerifyMismatchError, argon2_exc.InvalidHashError):
        return False
    # 未設定アカウントは照合成功扱いにしない（列挙耐性・A.1）
    return password_hash is not None


def generate_token(n_bytes: int = 32) -> str:
    """CSPRNG による不透明トークン（意味を埋め込まない・A.0）。"""
    return secrets.token_urlsafe(n_bytes)


# --- セッションストア（Redis・ADR §2.2） -----------------------------------------------
_SESS_PREFIX = "sess:"


def _sess_key(token: str) -> str:
    return f"{_SESS_PREFIX}{token}"


def create_session(r: redis.Redis, payload: dict) -> str:
    """新しいセッションを作成しトークンを返す。認証成功のたびに新トークン（固定化対策・A.0）。"""
    s = get_settings()
    token = generate_token()
    data = {**payload, "created_at": int(time.time())}
    r.set(_sess_key(token), json.dumps(data), ex=s.session_idle_ttl_seconds)
    return token


def read_session(r: redis.Redis, token: str) -> dict | None:
    """セッション取得。絶対TTL 超過なら破棄して None。生存ならアイドルTTLをスライディング延長。"""
    s = get_settings()
    raw = r.get(_sess_key(token))
    if raw is None:
        return None
    data = json.loads(raw)
    if int(time.time()) - int(data.get("created_at", 0)) > s.session_absolute_ttl_seconds:
        r.delete(_sess_key(token))
        return None
    r.expire(_sess_key(token), s.session_idle_ttl_seconds)
    return data


def delete_session(r: redis.Redis, token: str) -> None:
    r.delete(_sess_key(token))


# --- ログインのレート制限（Redis 固定窓・ADR §2.6） -------------------------------------
def check_login_rate_limit(r: redis.Redis, ip: str, login_id: str) -> None:
    """(IP+login_id) 単位の固定窓。上限超過で 429。総当りの一次抑止（ロックは MFA スライス）。"""
    s = get_settings()
    key = f"login_fail:{ip}:{login_id}"
    count = r.incr(key)
    if count == 1:
        r.expire(key, s.login_rate_limit_window_seconds)
    if count > s.login_rate_limit_max:
        raise AppError(429, "rate_limited", detail=f"retry after {r.ttl(key)}s")
