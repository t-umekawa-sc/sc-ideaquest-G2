"""リアルタイム配信のイベント発行（発行元＝H/E/C が呼ぶ・L.3）。

- **publish は sync**（`get_redis().publish`＝1 コール）。購読/転送は async ハブ（`hub.py`）。発行元の
  application 層（同期）から余計な async 化なしで呼べる。
- **fan-out backbone＝Redis Pub/Sub**（§1.14）。チャネル名＝トピック名そのもの（`notifications:{user_id}`／
  `chat:{chat_group_id}`）。ハブは `PSUBSCRIBE notifications:* / chat:*` で受ける。
- **封筒**＝`{topic,type,data,id,company_id}`。`company_id` はハブの cross-tenant フィルタ（§1.5・最後の砦）用。
- **L は配信専用**＝ここで発行されるのは「速報」。真実は REST（L.0）。best-effort（publish 失敗は本処理を壊さない）。
"""
from __future__ import annotations

import json
import logging
import uuid

from app.infra.cache import get_redis

logger = logging.getLogger("app.realtime")

REVOKE_CHANNEL = "realtime:revoke"  # L.4 購読強制ドロップの制御チャネル


def notifications_topic(user_id: uuid.UUID | str) -> str:
    return f"notifications:{user_id}"


def chat_topic(chat_group_id: uuid.UUID | str) -> str:
    return f"chat:{chat_group_id}"


def publish_event(topic: str, type: str, data: dict, *, company_id: uuid.UUID | str,
                  id: str | None = None) -> None:
    """トピックへイベントを発行（best-effort・L.3）。発行元の本処理はコミット後に呼ぶ（速報）。"""
    envelope = {"topic": topic, "type": type, "data": data,
                "id": id or str(uuid.uuid4()), "company_id": str(company_id)}
    try:
        get_redis().publish(topic, json.dumps(envelope, default=str, ensure_ascii=False))
    except Exception:  # noqa: BLE001 — 配信は速報の殻。本処理（REST・既にコミット済み）を壊さない。
        logger.warning("realtime publish failed (topic=%s type=%s)", topic, type, exc_info=True)


def publish_revoke(user_id: uuid.UUID | str, chat_group_id: uuid.UUID | str, *,
                   company_id: uuid.UUID | str) -> None:
    """購読強制ドロップ（L.4）＝対象 user×chat_group の `chat:` 購読をハブに切らせる。"""
    payload = {"user_id": str(user_id), "chat_group_id": str(chat_group_id),
               "company_id": str(company_id)}
    try:
        get_redis().publish(REVOKE_CHANNEL, json.dumps(payload, default=str, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        logger.warning("realtime revoke publish failed (user=%s cg=%s)", user_id, chat_group_id,
                       exc_info=True)
