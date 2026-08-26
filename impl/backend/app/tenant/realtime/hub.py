"""配信ハブ（プロセス毎シングルトン・L.4 配信モデル）。

- **1 プロセス 1 ハブ**＝全 WS 接続で Redis 購読と配信ループを共有する（接続ごとに `pubsub` を開かない）。
- **購読方式＝パターン購読**（`PSUBSCRIBE notifications:* / chat:*`・L.5(a) 実装単純）＋失効チャネル（`SUBSCRIBE realtime:revoke`）。
- **転送＝購読テーブル（topic→接続集合）＋ `company_id` フィルタ**（cross-tenant 遮断の最後の砦・§1.5）。
- **配信は receive ループと別コルーチン**（publish で動くのは配信のみ・L 配信モデル）。全て単一イベントループ上。
"""
from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.tenant.realtime.events import REVOKE_CHANNEL, chat_topic

logger = logging.getLogger("app.realtime.hub")


class Connection:
    """1 本の WS 接続。購読トピック集合と本人/テナントの束縛を持つ。"""

    def __init__(self, ws, *, account_id: str, user_id: str, company_id: str) -> None:
        self.ws = ws
        self.account_id = account_id
        self.user_id = user_id
        self.company_id = company_id
        self.topics: set[str] = set()

    async def send(self, envelope: dict) -> bool:
        try:
            await self.ws.send_json(envelope)
            return True
        except Exception:  # noqa: BLE001 — 送信失敗＝切断済み。呼び出し側が除去する。
            return False


class Hub:
    def __init__(self) -> None:
        self._topics: dict[str, set[Connection]] = {}
        self._pubsub = None
        self._redis = None
        self._task: asyncio.Task | None = None

    # --- ライフサイクル（lifespan から）---------------------------------------------------
    async def start(self) -> None:
        if self._task is not None:
            return
        self._redis = aioredis.from_url(get_settings().redis_url, decode_responses=True)
        self._pubsub = self._redis.pubsub()
        await self._pubsub.psubscribe("notifications:*", "chat:*")
        await self._pubsub.subscribe(REVOKE_CHANNEL)
        self._task = asyncio.create_task(self._listen(), name="realtime-hub")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, RuntimeError):
                pass
        try:
            if self._pubsub is not None:
                await self._pubsub.aclose()
            if self._redis is not None:
                await self._redis.aclose()
        except Exception:  # noqa: BLE001 — 停止は best-effort（テストのループ跨ぎ等でも落とさない）
            pass
        self._pubsub = self._redis = None
        self._topics.clear()

    # --- 購読テーブル（WS 接続側から）--------------------------------------------------
    def subscribe(self, conn: Connection, topic: str) -> None:
        self._topics.setdefault(topic, set()).add(conn)
        conn.topics.add(topic)

    def unsubscribe(self, conn: Connection, topic: str) -> None:
        self._topics.get(topic, set()).discard(conn)
        conn.topics.discard(topic)

    def remove(self, conn: Connection) -> None:
        for t in list(conn.topics):
            self.unsubscribe(conn, t)

    # --- Redis 購読ループ（配信）-------------------------------------------------------
    async def _listen(self) -> None:
        async for msg in self._pubsub.listen():
            if msg.get("type") not in ("pmessage", "message"):
                continue
            raw = msg.get("data")
            try:
                payload = json.loads(raw)
            except (TypeError, ValueError):
                continue
            channel = msg.get("channel")
            try:
                if channel == REVOKE_CHANNEL:
                    self._handle_revoke(payload)
                else:
                    await self._dispatch(payload.get("topic") or channel, payload)
            except Exception:  # noqa: BLE001 — 1 件の配信失敗でループを止めない
                logger.warning("realtime dispatch error", exc_info=True)

    async def _dispatch(self, topic: str, payload: dict) -> None:
        conns = list(self._topics.get(topic, ()))
        if not conns:
            return
        company_id = str(payload.get("company_id"))
        dead: list[Connection] = []
        for c in conns:
            if c.company_id != company_id:  # cross-tenant 遮断（§1.5・最後の砦）
                continue
            if not await c.send(payload):
                dead.append(c)
        for c in dead:
            self.remove(c)

    def _handle_revoke(self, payload: dict) -> None:
        """L.4＝対象 user×chat_group の `chat:` 購読を即ドロップ。"""
        topic = chat_topic(payload.get("chat_group_id"))
        user_id = str(payload.get("user_id"))
        company_id = str(payload.get("company_id"))
        for c in list(self._topics.get(topic, ())):
            if c.user_id == user_id and c.company_id == company_id:
                self.unsubscribe(c, topic)


_hub: Hub | None = None


def get_hub() -> Hub:
    global _hub
    if _hub is None:
        _hub = Hub()
    return _hub
