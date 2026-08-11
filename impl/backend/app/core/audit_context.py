"""監査ログ用のリクエストコンテキスト（実行者/IP/UA）を contextvar で運ぶ（B.6・§4.5）。

application のシグネチャを汚さず全操作で actor/IP/UA を自動記録するため、pure ASGI ミドルウェアが
リクエストごとに値を設定し、記録 helper（`audit.repository.record`）が読む。sync エンドポイントは
threadpool で実行されるが、ミドルウェアが同一タスクで設定した contextvar は実行時にコピーされ可視。
"""
from __future__ import annotations

from contextvars import ContextVar

from starlette.requests import Request

from app.core.deps import get_client_ip, resolve_session

_actor: ContextVar[str | None] = ContextVar("audit_actor", default=None)
_ip: ContextVar[str | None] = ContextVar("audit_ip", default=None)
_ua: ContextVar[str | None] = ContextVar("audit_ua", default=None)


def current_audit_context() -> tuple[str | None, str | None, str | None]:
    """(actor_account_id, ip, user_agent) を返す（未設定は None）。"""
    return _actor.get(), _ip.get(), _ua.get()


class AuditContextMiddleware:
    """各 HTTP リクエストの 実行者/確定IP/UA を contextvar に載せる（pure ASGI＝同一タスクで伝播）。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        actor = ip = ua = None
        try:
            request = Request(scope)  # ヘッダ/Cookie/client のみ参照（body は消費しない）
            ip = get_client_ip(request)          # 確定クライアント IP（ADR-0006）
            ua = request.headers.get("user-agent")
            session = resolve_session(request)   # best-effort（未ログインは None）
            if session is not None:
                actor = session.get("account_id")
        except Exception:  # 監査コンテキストの解決失敗で本処理を止めない（best-effort）
            actor = ip = ua = None
        tokens = (_actor.set(actor), _ip.set(ip), _ua.set(ua))
        try:
            await self.app(scope, receive, send)
        finally:
            _actor.reset(tokens[0])
            _ip.reset(tokens[1])
            _ua.reset(tokens[2])
