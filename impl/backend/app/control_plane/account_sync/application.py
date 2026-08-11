"""account_sync_outbox の適用ユースケース（データモデル §4.6・両プレーンを跨ぐ唯一の実行主体）。

`process_outbox_once()` を worker.py がループで呼ぶ。テストは本関数を直接呼ぶ（常駐不要）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.control_plane.account_sync import repository as sync_repo
from app.control_plane.account_sync.orm import OutboxEntry
from app.control_plane.auth import repository as account_repo
from app.core.config import get_settings
from app.db.control import control_session
from app.db.tenant import get_tenant_session
from app.tenant.profile import repository as user_repo
from app.tenant.quest_group import repository as qg_repo


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
                _apply_memberships(tsession, entry.account_id, entry.payload)  # users の後（FK順・B.5 step3）
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


def _apply_memberships(tsession, account_id, payload: dict) -> None:
    """payload の初期所属 `memberships:[{group_id, role}]` を会社DB `quest_group_members` へ冪等 upsert（B.5 step3）。

    `users` upsert の後に呼ぶ（FK 順序を保証）。`user_id` は会社DB `users.id`（`account_id` から解決）。

    **加算専用（upsert のみ・削除しない）**＝この経路の入力は**発行時（新規アカウント＝既存所属ゼロ）に限る**
    ため（`issue_account` のみが payload に memberships を積む・B.5 step3）。よって:
    - memberships が無い payload（identity/last_login/disable 等）は **no-op**（既存所属は保持・B-TC-071/096）。
    - memberships が現状の部分集合でも **omitted は削除しない**（加算のみ・B-TC-097）。
    **所属の「修正」（差分適用＝omitted を解除/tombstone・role 変更・追加/除外）は本ワーカではなく、
    会社DB を直接更新する編集経路が担う**＝`admin.application._apply_membership_diff`
    （`PATCH /admin/companies/{id}/accounts/{account_id}`・B.3・outbox 非経由）／QG管理者 API
    `admin.quest_group_application.add_member`/`remove_member`（B.4）。将来ここへ「修正」を載せると
    加算専用ゆえ削除が効かない silent bug になるため、修正は必ず編集経路を使うこと。
    """
    memberships = payload.get("memberships")
    if not memberships:
        return
    user = user_repo.get_user_by_account(tsession, account_id)
    if user is None:
        # users ミラー未生成では所属を張れない（FK）。payload に display_name が無い異常系＝リトライさせる。
        raise RuntimeError(f"user mirror for account {account_id} not found; cannot apply memberships")
    for m in memberships:
        qg_repo.upsert_membership(
            tsession, uuid.UUID(str(m["group_id"])), user.id, m.get("role", "member")
        )
