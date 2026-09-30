"""AIジョブワーカの起動点（別プロセス・FR-45・設計 §5.2(a)）。

会社DBの `ai_jobs`（queued）をポーリングし、`FOR UPDATE SKIP LOCKED` で N 件だけ running にして LLM
ゲートウェイ（infra/llm）で実行する常駐ワーカ。account_sync（worker.py）・mail（mail_worker.py）とは
**別プロセス**で障害隔離する（LLM 詰まりが他へ波及しない）。本体ロジックは
`app.tenant.ai_jobs.application.process_all_companies_once`（テストは会社単位の関数を直接呼ぶ＝常駐不要）。
同時実行 N は最小スペック向けに既定1（config `llm_worker_concurrency`）。
"""
from __future__ import annotations

import logging
import signal
import time

from app.core.config import get_settings
from app.core.logging_config import configure_logging
from app.tenant.ai_jobs.application import process_all_companies_once

configure_logging("llm-worker")  # JSONL/ファイル/相関＝backend と同一設定（別ファイル llm-worker.jsonl）。
logger = logging.getLogger("llm_worker")


def main() -> None:
    interval = get_settings().llm_worker_poll_interval_seconds
    stop = {"requested": False}

    def _handle(_signum, _frame) -> None:  # noqa: ANN001
        stop["requested"] = True

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    logger.info("ai_jobs worker started (interval=%ss)", interval, extra={"event": "worker_start", "interval": interval})
    while not stop["requested"]:
        try:
            stats = process_all_companies_once()
            if stats.get("succeeded") or stats.get("failed") or stats.get("canceled") or stats.get("errors"):
                level = logging.WARNING if (stats.get("failed") or stats.get("errors")) else logging.INFO
                logger.log(level, "ai_jobs pass: %s", stats, extra={"event": "ai_jobs_pass", **stats})
        except Exception:  # noqa: BLE001  (1巡失敗で常駐を落とさない・次巡で再試行)
            logger.exception("ai_jobs pass failed", extra={"event": "ai_jobs_pass_failed"})
        time.sleep(interval)
    logger.info("ai_jobs worker stopped", extra={"event": "worker_stop"})


if __name__ == "__main__":
    main()
