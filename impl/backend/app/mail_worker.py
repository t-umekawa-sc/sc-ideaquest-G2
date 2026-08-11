"""mail_outbox ワーカの起動点（別プロセス・ADR-0007 §2.3）。

認証系メール（OTP／設定リンク／ロック通知）を非同期送信する常駐ワーカ。account_sync ワーカ
（worker.py）とは**別プロセス**で、SMTP 詰まりが DB ミラー反映へ波及しないよう障害隔離する。
本体ロジックは `app.control_plane.mail_outbox.application`（テストはそれを直接呼ぶ＝常駐不要）。
`done` 行の掃除（retention）は毎巡ではなく間引いて実行する（§2.7）。
"""
from __future__ import annotations

import logging
import signal
import time

from app.control_plane.mail_outbox.application import (
    cleanup_done_mail_outbox,
    process_mail_outbox_once,
)
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mail_worker")

# 掃除の間引き＝この回数の送信パスごとに 1 回 done 行のクリーンアップを走らせる。
_CLEANUP_EVERY_N_PASSES = 300


def main() -> None:
    interval = get_settings().mail_outbox_poll_interval_seconds
    stop = {"requested": False}

    def _handle(_signum, _frame) -> None:  # noqa: ANN001
        stop["requested"] = True

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    logger.info("mail_outbox worker started (interval=%ss)", interval)
    passes = 0
    while not stop["requested"]:
        try:
            stats = process_mail_outbox_once()
            if stats.get("sent") or stats.get("failed") or stats.get("reclaimed"):
                logger.info("mail pass: %s", stats)
            passes += 1
            if passes % _CLEANUP_EVERY_N_PASSES == 0:
                deleted = cleanup_done_mail_outbox()
                if deleted:
                    logger.info("mail cleanup: deleted %s done rows", deleted)
        except Exception:  # noqa: BLE001  (1巡失敗で常駐を落とさない・次巡で再試行)
            logger.exception("mail pass failed")
        time.sleep(interval)
    logger.info("mail_outbox worker stopped")


if __name__ == "__main__":
    main()
