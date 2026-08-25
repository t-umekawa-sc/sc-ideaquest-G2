"""FastAPI エントリ。

- request_id ミドルウェア（problem+json に載せる・§1.7）
- RFC7807 エラーハンドラ
- 認証ルータ（/api/v1/auth）
- /healthz（DB/Redis 疎通）
"""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from sqlalchemy import text

from app.control_plane.admin.router import router as admin_router
from app.control_plane.auth.router import router as auth_router
from app.control_plane.me.router import router as me_router
from app.tenant.quests.router import router as quests_router
from app.tenant.ideas.router import router as ideas_router
from app.tenant.evaluations.router import router as evaluations_router
from app.tenant.chat.router import router as chat_router
from app.core.audit_context import AuditContextMiddleware
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.db.control import control_session
from app.infra.cache import get_redis

logger = logging.getLogger("app")


def _warn_untrusted_proxy_config() -> None:
    """本番で信頼プロキシ段数が未設定なら警告（ADR-0006 §2.2）。

    prod かつ trusted_proxy_count=0 だと (IP+login_id) 制限が実クライアント IP でなく
    プロキシ IP に潰れる恐れ（設定漏れの早期検知）。ハードエラーにはしない。
    """
    s = get_settings()
    if s.app_env == "prod" and s.trusted_proxy_count == 0:
        logger.warning(
            "TRUSTED_PROXY_COUNT=0 in prod: レート制限/ロックがプロキシ IP に潰れる恐れ。"
            "エッジの信頼プロキシ段数に一致させてください（ADR-0006・本番デプロイ要件.md §1）。"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    _warn_untrusted_proxy_config()
    yield


app = FastAPI(title="ideaquest backend", version="0.0.1", lifespan=lifespan)

app.add_middleware(AuditContextMiddleware)  # 監査ログの実行者/IP/UA を contextvar に載せる（B.6・§4.5）
install_error_handlers(app)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(me_router)
app.include_router(quests_router)  # テナントプレーン（ドメイン C・SC-10 読み取り）
app.include_router(ideas_router)  # テナントプレーン（ドメイン D・アイデア CRUD/公開）
app.include_router(evaluations_router)  # テナントプレーン（ドメイン F・評価/選定/投稿者コイン）
app.include_router(chat_router)  # テナントプレーン（ドメイン E・チャット/既読/活発度）


@app.middleware("http")
async def add_request_id(request: Request, call_next):  # noqa: ANN001, ANN201
    request_id = f"req_{uuid.uuid4().hex}"
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/healthz")
def healthz() -> dict:
    """DB（管理DB）と Redis への疎通を確認する。"""
    checks = {"db": False, "redis": False}
    try:
        with control_session() as session:
            session.execute(text("SELECT 1"))
        checks["db"] = True
    except Exception:  # noqa: BLE001  (疎通確認なので詳細は握りつぶし false を返す)
        checks["db"] = False
    try:
        get_redis().ping()
        checks["redis"] = True
    except Exception:  # noqa: BLE001
        checks["redis"] = False
    status = "ok" if all(checks.values()) else "degraded"
    return {"status": status, "checks": checks}
