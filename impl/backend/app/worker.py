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
from app.core.logging_config import configure_logging

configure_logging("worker")  # JSONL/ファイル/相関＝backend と同一設定（別ファイル worker.jsonl）。
logger = logging.getLogger("worker")


def main() -> None:
    interval = get_settings().outbox_poll_interval_seconds
    stop = {"requested": False}

    def _handle(_signum, _frame) -> None:  # noqa: ANN001
        stop["requested"] = True

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    logger.info("account_sync outbox worker started (interval=%ss)", interval, extra={"event": "worker_start", "interval": interval})
    while not stop["requested"]:
        try:
            stats = process_outbox_once()
            # データ整合の要（管理DB→会社DB ミラー）＝1件でも処理があれば件数を構造化記録（不整合追跡・full）。
            if stats.get("done") or stats.get("failed") or stats.get("blocked"):
                level = logging.WARNING if stats.get("failed") else logging.INFO
                logger.log(level, "outbox pass: %s", stats, extra={"event": "outbox_pass", **stats})
        except Exception:  # noqa: BLE001  (1巡失敗で常駐を落とさない・次巡で再試行)
            logger.exception("outbox pass failed", extra={"event": "outbox_pass_failed"})
        time.sleep(interval)
    logger.info("account_sync outbox worker stopped", extra={"event": "worker_stop"})


if __name__ == "__main__":
    main()
