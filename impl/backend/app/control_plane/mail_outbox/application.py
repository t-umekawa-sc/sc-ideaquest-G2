"""mail_outbox の送信ユースケース（ADR-0007・§4.7・両プレーンは跨がない＝SMTP のみ）。

`process_mail_outbox_once()` を mail_worker.py がループで呼ぶ。テストは本関数を直接呼ぶ（常駐不要）。
順序保証・HOL ブロッキングは無い＝各メールは独立（1 通の失敗が他を止めない・§2.4）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, update

# FK ターゲット（accounts/companies）を metadata に登録する。mail_worker は別プロセスで、これが無いと
# MailOutboxEntry の FK 解決に失敗する（done 書込のフラッシュで NoReferencedTableError）。テストは
# conftest が auth.orm を import 済みのため再現せず、別プロセスの worker でのみ露見する。
from app.control_plane.auth import orm as _auth_orm  # noqa: F401
from app.control_plane.mail_outbox import repository as mail_repo
from app.control_plane.mail_outbox.orm import MailOutboxEntry
from app.control_plane.mail_outbox.templates import render
from app.core.config import get_settings
from app.db.control import control_session
from app.infra.mail import get_mail_sender


def process_mail_outbox_once() -> dict:
    """未送信の mail_outbox を 1 巡だけ処理する（§2.4/§2.5）。処理件数の要約を返す。

    (1) `sending` 滞留の再送戻し → (2) `pending` を `seq` 昇順で 1 件ずつ確保して送信。
    """
    stats = {"sent": 0, "failed": 0, "reclaimed": 0}
    stats["reclaimed"] = _reclaim_stuck_sending()
    with control_session() as session:
        ids = mail_repo.fetch_pending_ids(session)
    for entry_id in ids:
        result = _send_one(entry_id)
        if result == "sent":
            stats["sent"] += 1
        elif result == "failed":
            stats["failed"] += 1
    return stats


def _reclaim_stuck_sending() -> int:
    """`sending` のまま reclaim 閾値を超えた行を `pending` へ戻す（クラッシュ疑い・§2.5）。"""
    s = get_settings()
    threshold = datetime.now(timezone.utc) - timedelta(seconds=s.mail_outbox_sending_reclaim_seconds)
    with control_session() as session:
        rowcount = session.execute(
            update(MailOutboxEntry)
            .where(MailOutboxEntry.status == "sending", MailOutboxEntry.claimed_at < threshold)
            .values(status="pending", claimed_at=None)
        ).rowcount
        session.commit()
    return rowcount


def _send_one(entry_id: uuid.UUID) -> str:
    """1 件を確保→送信→done 化。成功 `sent`／失敗 `failed`／確保できず `skip` を返す。

    「確保（pending→sending）」と「送信」と「done 書込」は別 I/O で単一 Tx にできない＝
    at-least-once。送信前に status=sending を原子的に立て、成功後に done＋secret NULL（§2.5/§2.7）。
    """
    now = datetime.now(timezone.utc)
    # 1) 原子的に確保（pending→sending）。取れなければ他が処理中＝skip。
    with control_session() as session:
        claimed = session.execute(
            update(MailOutboxEntry)
            .where(MailOutboxEntry.id == entry_id, MailOutboxEntry.status == "pending")
            .values(status="sending", claimed_at=now)
        ).rowcount
        session.commit()
        if not claimed:
            return "skip"
        entry = session.get(MailOutboxEntry, entry_id)
        to_email, category, secret, locale = entry.to_email, entry.category, entry.secret, entry.locale

    # 2) DB 接続を持たずに送信（SMTP 中はセッションを閉じる）。本文は送信時にレンダリング（§2.7）。
    try:
        subject, body = render(category, secret, locale)
        get_mail_sender().send(to_email, subject, body)
    except Exception:
        return _mark_failure(entry_id)

    # 3) 成功＝done＋secret NULL 化
    with control_session() as session:
        entry = session.get(MailOutboxEntry, entry_id)
        entry.status = "done"
        entry.secret = None
        entry.claimed_at = None
        entry.processed_at = datetime.now(timezone.utc)
        session.commit()
    return "sent"


def _mark_failure(entry_id: uuid.UUID) -> str:
    """送信失敗＝attempts++。上限未満は `pending`（次巡で再送）、上限超で `failed`＋secret NULL。"""
    s = get_settings()
    with control_session() as session:
        entry = session.get(MailOutboxEntry, entry_id)
        entry.attempts += 1
        if entry.attempts >= s.mail_outbox_max_attempts:
            entry.status = "failed"  # 端末失敗＝要手動対応（監視/アラート対象）
            entry.secret = None      # 秘匿値を破棄（手動再送は新規 enqueue でやり直す）
            entry.processed_at = datetime.now(timezone.utc)
        else:
            entry.status = "pending"  # 次巡で再送
        entry.claimed_at = None
        session.commit()
    return "failed"


def cleanup_done_mail_outbox() -> int:
    """`done` かつ retention を過ぎた行を削除（§2.7・mail_worker が間引いて呼ぶ）。削除件数を返す。

    `failed` 行は要手動対応のため削除しない。`secret` は done/failed 化時に既に NULL。
    """
    s = get_settings()
    threshold = datetime.now(timezone.utc) - timedelta(seconds=s.mail_outbox_done_retention_seconds)
    with control_session() as session:
        rowcount = session.execute(
            delete(MailOutboxEntry)
            .where(MailOutboxEntry.status == "done", MailOutboxEntry.processed_at < threshold)
        ).rowcount
        session.commit()
    return rowcount
