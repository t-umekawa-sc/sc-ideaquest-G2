"""FastAPI エントリ（Chunk 1＝起動骨格）。

認証ルータは Chunk 2 で追加する。ここでは疎通確認用の /healthz のみ。
"""
from __future__ import annotations

from fastapi import FastAPI
from sqlalchemy import text

from app.core.db import control_session
from app.core.redis import get_redis

app = FastAPI(title="ideaquest backend", version="0.0.1")


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
