"""account_sync_outbox の適用ユースケース（データモデル §4.6・両プレーンを跨ぐ唯一の実行主体）。

`process_outbox_once()` を worker.py がループで呼ぶ。テストは本関数を直接呼ぶ（常駐不要）。
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.control_plane.account_sync import repository as sync_repo
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth import repository as account_repo
from app.core.config import get_settings
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as user_repo


def process_outbox_once() -> dict:
    """未完了の outbox を1巡だけ処理する（§4.6）。処理件数の要約を返す。

    - 取り出し＝`status != done` を `seq`（挿入順＝因果順）昇順。
    - 直列適用＝**同一 account は seq 順に1件ずつ**。失敗（retry/failed）したらその account の後続は
      今回進めない（ヘッドオブライン・ブロッキング）。**異なる account は独立**に処理する。
    """
    with control_session() as session:
        unfinished = sync_repo.fetch_unfinished(session)
        order: list = []
        by_account: dict = {}
        for e in unfinished:
            if e.account_id not in by_account:
                by_account[e.account_id] = []
                order.append(e.account_id)
            by_account[e.account_id].append((e.id, e.status))

    stats = {"done": 0, "failed": 0, "blocked": 0}
    for account_id in order:
        for entry_id, status in by_account[account_id]:
            if status == "failed":
                stats["blocked"] += 1  # 端末失敗が先頭を塞ぐ＝要手動対応まで後続を進めない
                break
            if _apply_one(entry_id):
                stats["done"] += 1
            else:
                stats["failed"] += 1
                break  # HOL: この account の後続は今回進めない（退行防止）
    return stats


def _apply_one(entry_id) -> bool:
    """1件を会社DB へ適用し done 化。失敗は attempts++（上限超で failed）。成否を返す。

    会社DB(users) と 管理DB(outbox.status) は別インスタンスで単一Tx にできない＝先に会社DB へ
    冪等 upsert し、その後 status=done を書く。途中で落ちても at-least-once＋冪等 upsert で安全（§4.6）。
    """
    s = get_settings()
    with control_session() as session:
        entry = session.get(OutboxEntry, entry_id)
        if entry is None or entry.status == "done":
            return True
        try:
            company = account_repo.get_company(session, entry.company_id)
            if company is None:
                raise RuntimeError(f"company {entry.company_id} not found")
            with get_tenant_session(company.db_identifier) as tsession:
                user_repo.upsert_user_mirror(tsession, entry.account_id, entry.payload)
                tsession.commit()
            entry.status = "done"
            entry.processed_at = datetime.now(timezone.utc)
            session.commit()
            return True
        except Exception:
            entry.attempts += 1
            if entry.attempts >= s.outbox_max_attempts:
                entry.status = "failed"  # 上限超＝要手動対応（監視/アラート対象）
            session.commit()
            return False
