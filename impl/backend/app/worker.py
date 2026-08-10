"""outbox ワーカの起動点（別プロセス・§3.4）。

`account_sync_outbox`（管理DB→会社DB のミラー反映・API設計 §1.13・データモデル §4.6）を処理する
常駐ワーカ。**両プレーンを跨ぐ唯一の実行主体**。本体ロジックは
`app.control_plane.account_sync.application.process_outbox_once`（テストはそれを直接呼ぶ）。
"""
from __future__ import annotations

import logging
import signal
import time

from app.control_plane.account_sync.application import process_outbox_once
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker")


def main() -> None:
    interval = get_settings().outbox_poll_interval_seconds
    stop = {"requested": False}

    def _handle(_signum, _frame) -> None:  # noqa: ANN001
        stop["requested"] = True

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    logger.info("account_sync outbox worker started (interval=%ss)", interval)
    while not stop["requested"]:
        try:
            stats = process_outbox_once()
            if stats.get("done") or stats.get("failed") or stats.get("blocked"):
                logger.info("outbox pass: %s", stats)
        except Exception:  # noqa: BLE001  (1巡失敗で常駐を落とさない・次巡で再試行)
            logger.exception("outbox pass failed")
        time.sleep(interval)
    logger.info("account_sync outbox worker stopped")


if __name__ == "__main__":
    main()
