"""ログ相関のためのリクエストコンテキスト（request_id / テナント）を contextvar で運ぶ。

監査コンテキスト（実行者/IP/UA）は [`audit_context`](audit_context.py) が別途 contextvar で保持する。
本モジュールは「1リクエストを串刺しで追える」ための相関IDと、マルチテナントの識別子（会社DB）を足す。
ログフィルタ（[`logging_config.ContextFilter`](logging_config.py)）がこれらを全 LogRecord に注入するため、
router/application/repository/domain のどの層のログにも request_id とテナントが自動で乗る。
"""
from __future__ import annotations

from contextvars import ContextVar, Token

# 1リクエストの相関ID（`req_<uuid>`）。main.add_request_id が設定し、レスポンスの X-Request-ID と一致する。
_request_id: ContextVar[str | None] = ContextVar("log_request_id", default=None)
# テナント識別子（会社DB の db_identifier）。get_tenant_session が設定＝テナント処理中のログに乗る。
_tenant: ContextVar[str | None] = ContextVar("log_tenant", default=None)


def set_request_id(value: str | None) -> Token:
    return _request_id.set(value)


def reset_request_id(token: Token) -> None:
    _request_id.reset(token)


def get_request_id() -> str | None:
    return _request_id.get()


def set_tenant(value: str | None) -> Token:
    return _tenant.set(value)


def reset_tenant(token: Token) -> None:
    _tenant.reset(token)


def get_tenant() -> str | None:
    return _tenant.get()
