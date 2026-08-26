"""WS ハンドシェイク `GET /api/v1/realtime`（L.1）。

- 認証＝既存 httpOnly Cookie セッション（`iq_session`・§1.4）をハンドシェイクで検証（未認証は accept せずクローズ）。
- Origin 検証（§1.4・A.0）＝ブラウザ由来のみ許可（トークンは URL に載せない）。
- 接続を `account_id/user_id/company_id` にバインドし `notifications:{user_id}` を**自動購読**。
- 受信ループ＝`{op:subscribe|unsubscribe, topic}` の**購読制御のみ**（receive-only・書き込み経路にしない・L.0）。
  `chat:{cg}` の subscribe は門番（L.2）を通す。配信は別コルーチン（ハブ）。
"""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import read_session
from app.infra.cache import get_redis
from app.tenant.realtime.events import notifications_topic
from app.tenant.realtime.gate import can_subscribe_chat
from app.tenant.realtime.hub import Connection, get_hub

router = APIRouter(prefix="/api/v1", tags=["realtime"])


def _origin_ok(ws: WebSocket) -> bool:
    origin = ws.headers.get("origin")
    if origin is not None and origin not in get_settings().allowed_origins:
        return False
    if ws.headers.get("sec-fetch-site") == "cross-site":
        return False
    return True


@router.websocket("/realtime")
async def realtime(ws: WebSocket) -> None:
    if not _origin_ok(ws):
        await ws.close(code=1008)  # policy violation（Origin 拒否）
        return
    token = ws.cookies.get("iq_session")
    payload = read_session(get_redis(), token) if token else None
    user_id = (payload or {}).get("user", {}).get("user_id")
    if payload is None or user_id is None:
        await ws.close(code=1008)  # 未認証＝101 を返さずクローズ（L.1）
        return

    await ws.accept()
    conn = Connection(ws, account_id=payload["account_id"], user_id=user_id,
                      company_id=payload["company_id"])
    hub = get_hub()
    hub.subscribe(conn, notifications_topic(user_id))  # 常時購読（本人固定・L.2）
    try:
        while True:
            msg = await ws.receive_json()
            await _handle_control(hub, conn, msg)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.remove(conn)


async def _handle_control(hub, conn: Connection, msg: dict) -> None:
    op = msg.get("op")
    topic = msg.get("topic") or ""
    if op == "subscribe" and topic.startswith("chat:"):
        cg_id = topic.split(":", 1)[1]
        allowed = await run_in_threadpool(
            can_subscribe_chat, conn.account_id, conn.company_id, cg_id
        )
        if allowed:
            hub.subscribe(conn, topic)
            await conn.ws.send_json({"op": "subscribed", "topic": topic})
        else:  # 存在秘匿＝詳細を返さない（L.2）
            await conn.ws.send_json({"op": "error", "topic": topic, "code": "subscribe_denied"})
    elif op == "unsubscribe" and topic:
        hub.unsubscribe(conn, topic)
        await conn.ws.send_json({"op": "unsubscribed", "topic": topic})
