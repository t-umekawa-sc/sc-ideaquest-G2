"""リクエスト横断の検証（認可ガード・CSRF・Origin）。imperative shell（§3.1）。

評価順序の約束（A-TC-014/015）: 認証（401）を CSRF（403）より先に評価する。
そのためルータ側では「セッション解決 → Origin → CSRF」の順に呼ぶ。
"""
from __future__ import annotations

import secrets

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.redis import get_redis
from app.repository import session_repo


def resolve_session(request: Request) -> dict | None:
    token = request.cookies.get("iq_session")
    if not token:
        return None
    return session_repo.get_session(get_redis(), token)


def require_session(request: Request) -> dict:
    session = resolve_session(request)
    if session is None:
        raise AppError(401, "unauthenticated")
    return session


def verify_origin(request: Request) -> None:
    """Origin / Sec-Fetch-Site 検証（A.0）。ヘッダが無い非ブラウザ呼び出しは許容（CSRF トークンで担保）。"""
    s = get_settings()
    origin = request.headers.get("origin")
    if origin is not None and origin not in s.allowed_origins:
        raise AppError(403, "forbidden", detail="origin rejected")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise AppError(403, "forbidden", detail="cross-site request rejected")


def verify_csrf(request: Request) -> None:
    """ダブルサブミット（A.0）: 非httpOnly Cookie `iq_csrf` と `X-CSRF-Token` ヘッダの一致。"""
    cookie = request.cookies.get("iq_csrf")
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise AppError(403, "csrf_failed")
