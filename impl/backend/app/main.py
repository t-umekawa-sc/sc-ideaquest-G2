"""FastAPI エントリ。

- request_id ミドルウェア（problem+json に載せる・§1.7）
- RFC7807 エラーハンドラ
- 認証ルータ（/api/v1/auth）
- /healthz（DB/Redis 疎通）
"""
from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from sqlalchemy import text

from app.core.db import control_session
from app.core.errors import install_error_handlers
from app.core.redis import get_redis
from app.routers.auth import router as auth_router

app = FastAPI(title="ideaquest backend", version="0.0.1")

install_error_handlers(app)
app.include_router(auth_router)


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
