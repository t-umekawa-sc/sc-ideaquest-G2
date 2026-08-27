"""リクエスト横断の検証（認可ガード・CSRF・Origin）。imperative shell（§3.1）。

評価順序の約束（A-TC-014/015）: 認証（401）を CSRF（403）より先に評価する。
そのためルータ側では「セッション解決 → Origin → CSRF」の順に呼ぶ。
"""
from __future__ import annotations

import secrets

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.net import resolve_client_ip
from app.core.security import read_preauth, read_session
from app.infra.cache import get_redis


def get_client_ip(request: Request) -> str:
    """実クライアント IP を確定（ADR-0006）。信頼プロキシ段数は env（`trusted_proxy_count`）。"""
    peer = request.client.host if request.client else "unknown"
    return resolve_client_ip(peer, request.headers.get("x-forwarded-for"), get_settings().trusted_proxy_count)


def resolve_session(request: Request) -> dict | None:
    token = request.cookies.get("iq_session")
    if not token:
        return None
    session = read_session(get_redis(), token)
    if session is not None:
        # ログイン済みユーザー設定を locale 解決の最優先ソースとして載せる（§2.1・エラー応答の言語）。
        request.state.user_locale = session.get("locale")
    return session


def require_session(request: Request) -> dict:
    session = resolve_session(request)
    if session is None:
        raise AppError(401, "unauthenticated")
    return session


def require_preauth(request: Request) -> tuple[str, dict]:
    """pre-auth（`iq_preauth`）必須。最小権限＝mfa/verify・mfa/resend のみが使う（A.0）。

    無い/期限切れは 401 preauth_expired（CSRF より先に評価＝A-TC-014/015 と同方針）。
    トークンと Redis ペイロードを返す（呼び出し側が消費/更新する）。
    """
    token = request.cookies.get("iq_preauth")
    payload = read_preauth(get_redis(), token) if token else None
    if not token or payload is None:
        raise AppError(401, "preauth_expired")
    return token, payload


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
