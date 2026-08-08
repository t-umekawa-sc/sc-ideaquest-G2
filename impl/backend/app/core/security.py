"""パスワードハッシュ等のセキュリティ基盤（ADR-0001 §2.5）。

Argon2id（m=19MiB, t=2, p=1・OWASP 下限ベースライン）。
セッション/CSRF トークン発行は Chunk 2（auth エンドポイント）で追加する。
"""
from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc

# ADR-0001 §2.5 の採用値
_ph = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)

# 存在しないアカウントでもタイミング差を作らないためのダミーハッシュ（ADR-0001 §2.5）
_DUMMY_HASH = _ph.hash("x" * 24)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """PW 照合。password_hash が None（未設定）でも必ずダミー照合を行い時間差を作らない。"""
    target = password_hash or _DUMMY_HASH
    try:
        _ph.verify(target, password)
    except argon2_exc.VerifyMismatchError:
        return False
    except argon2_exc.InvalidHashError:
        return False
    # 未設定アカウントは照合成功扱いにしない（列挙耐性・A.1）
    return password_hash is not None


def generate_token(n_bytes: int = 32) -> str:
    """CSPRNG による不透明トークン（意味を埋め込まない・A.0）。"""
    return secrets.token_urlsafe(n_bytes)
