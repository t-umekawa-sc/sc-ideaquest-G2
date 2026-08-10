"""account_sync_outbox の読み書き（管理DB・データモデル §4.6）。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.control_plane.account_sync.orm import OutboxEntry


def enqueue(
    session: Session, account_id: uuid.UUID, company_id: uuid.UUID, op: str, payload: dict
) -> None:
    """反映すべき仕事を1行 INSERT（呼び出し側の Tx に相乗＝accounts 更新と同一Tx・§4.6）。"""
    session.add(
        OutboxEntry(
            id=uuid.uuid4(),
            account_id=account_id,
            company_id=company_id,
            op=op,
            payload=payload,
            status="pending",
            attempts=0,
        )
    )


def fetch_unfinished(session: Session) -> list[OutboxEntry]:
    """未完了（pending/failed）を seq 昇順で取得（取り出し順＝挿入順＝因果順・§4.6）。"""
    return list(
        session.execute(
            select(OutboxEntry).where(OutboxEntry.status != "done").order_by(OutboxEntry.seq)
        ).scalars()
    )
