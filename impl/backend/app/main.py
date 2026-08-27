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
from app.tenant.gamification.router import router as gamification_router
from app.tenant.shop.router import router as shop_router
from app.tenant.achievements.router import router as achievements_router
from app.tenant.notifications.router import router as notifications_router
from app.tenant.realtime.router import router as realtime_router
from app.tenant.realtime.hub import get_hub
from app.tenant.dashboard.router import router as dashboard_router
from app.tenant.search.router import router as search_router
from app.core.audit_context import AuditContextMiddleware
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.idempotency import idempotency_middleware
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
    await get_hub().start()  # 配信ハブ起動＝Redis 購読ループ（L・§1.12）
    try:
        yield
    finally:
        await get_hub().stop()


def _docs_kwargs(app_env: str) -> dict:
    """本番は API スキーマ/Swagger を非公開にする（本番デプロイ要件 §2）。

    最小 CSP（`default-src 'none'`・§10）下では Swagger UI 資産が読めず無意味な上、OpenAPI スキーマの
    公開自体を避けたい。prod では `/docs`・`/redoc`・`/openapi.json` を全て無効化（非 prod は既定のまま）。
    """
    if app_env == "prod":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


app = FastAPI(
    title="ideaquest backend", version="0.0.1", lifespan=lifespan,
    **_docs_kwargs(get_settings().app_env),
)

app.add_middleware(AuditContextMiddleware)  # 監査ログの実行者/IP/UA を contextvar に載せる（B.6・§4.5）
install_error_handlers(app)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(me_router)
app.include_router(quests_router)  # テナントプレーン（ドメイン C・SC-10 読み取り）
app.include_router(ideas_router)  # テナントプレーン（ドメイン D・アイデア CRUD/公開）
app.include_router(evaluations_router)  # テナントプレーン（ドメイン F・評価/選定/投稿者コイン）
app.include_router(chat_router)  # テナントプレーン（ドメイン E・チャット/既読/活発度）
app.include_router(gamification_router)  # テナントプレーン（ドメイン G・魔法カタログ/解放）
app.include_router(shop_router)  # テナントプレーン（ドメイン G・ショップ/装備 SC-30/31）
app.include_router(achievements_router)  # テナントプレーン（ドメイン G・実績 SC-40）
app.include_router(notifications_router)  # テナントプレーン（ドメイン H・通知 SC-02＋ヘッダーベル）
app.include_router(realtime_router)  # テナントプレーン（ドメイン L・WS 配信ハブ /realtime）
app.include_router(dashboard_router)  # テナントプレーン（ドメイン I・ダッシュボード集約 SC-01）
app.include_router(search_router)  # テナントプレーン（ドメイン J・全文検索 SC-12）


# 冪等キー（§1.9）＝add_request_id の内側（request_id 設定後）に置く。header 無し POST は素通し。
app.middleware("http")(idempotency_middleware)


@app.middleware("http")
async def add_request_id(request: Request, call_next):  # noqa: ANN001, ANN201
    request_id = f"req_{uuid.uuid4().hex}"
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    # セキュリティ応答ヘッダ（セキュリティ対策一覧 §10）。API は JSON 応答のため CSP は最小（default-src 'none'）で
    # 十分＋クリックジャッキング対策に frame-ancestors/X-Frame。HSTS は TLS 環境（cookie_secure=本番）でのみ付与。
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if get_settings().cookie_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
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
