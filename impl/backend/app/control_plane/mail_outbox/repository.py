"""mail_outbox の読み書き（管理DB・データモデル §4.7・ADR-0007）。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.control_plane.mail_outbox.orm import MailOutboxEntry


def enqueue(
    session: Session,
    to_email: str,
    category: str,
    *,
    secret: str | None = None,
    locale: str | None = None,
    params: dict | None = None,
    account_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
) -> None:
    """送信すべきメールを 1 行 INSERT（`status=pending`・§2.6）。

    呼び出し側の Tx に相乗る（`password-setup/request` は otp_challenges 作成と同一Tx＝原子化）。
    完成本文は保存せず、秘匿値は `secret` に隔離する（ワーカが送信時にレンダリング・§2.7）。
    `params`＝非秘匿の描画パラメータ（new_device の ip/device/at 等・§4）。
    """
    session.add(
        MailOutboxEntry(
            id=uuid.uuid4(),
            to_email=to_email,
            category=category,
            secret=secret,
            locale=locale,
            params=params,
            account_id=account_id,
            company_id=company_id,
            status="pending",
            attempts=0,
        )
    )


def fetch_pending_ids(session: Session) -> list[uuid.UUID]:
    """`pending` を `seq` 昇順で id 列挙（取り出し順＝挿入順・§2.4）。各 id は個別に確保して送る。"""
    return list(
        session.execute(
            select(MailOutboxEntry.id)
            .where(MailOutboxEntry.status == "pending")
            .order_by(MailOutboxEntry.seq)
        ).scalars()
    )
