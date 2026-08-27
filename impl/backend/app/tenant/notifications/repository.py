"""通知リポジトリ（会社DB・§5.24・ドメイン H）。すべて recipient スコープ（IDOR 対策・H.4）。

一覧＝新着降順のカーソル（§1.8）。未読集計＝index `(recipient_id, is_read, created_at)`。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.tenant.achievements.orm import Achievement
from app.tenant.chat.orm import Spell
from app.tenant.ideas.orm import Idea
from app.tenant.notifications.orm import Notification
from app.tenant.quests.orm import Quest


def add(session: Session, n: Notification) -> Notification:
    session.add(n)
    return n


def prime_refs(session: Session, rows: list[Notification]) -> None:
    """一覧描画（catalog.render）の per-row ref 解決を identity map 事前ロードで一括化（H.2・N+1 回避）。

    catalog.render は各通知の ref（idea/quest/achievement/spell）を `session.get`（PK 引き）で解決する。
    `Session.get` は identity map を先に見るため、ページ分の ref id をまとめて IN ロードしておくと後続の
    get は追加クエリ無しで解決される（DB 往復を rows 件→種別数件へ）。描画側の署名は変えない（DRY）。

    注意＝identity map は**弱参照**。ロードした ORM を捨てると render 前に GC されて get が再クエリするため、
    `session.info` に強参照を残して描画完了までライフタイムを延ばす。
    """
    keep = session.info.setdefault("_primed_refs", [])

    def _load(model, ids) -> None:
        wanted = {i for i in ids if i is not None}
        if wanted:
            keep.extend(session.execute(select(model).where(model.id.in_(wanted))).scalars().all())

    _load(Idea, (n.ref_idea_id for n in rows))          # _idea_title/_quest_context 用
    _load(Achievement, (n.ref_achievement_id for n in rows))
    spell_ids: list[uuid.UUID] = []
    for n in rows:
        sid = (n.params or {}).get("spell_id")
        if sid:
            spell_ids.append(uuid.UUID(sid) if isinstance(sid, str) else sid)
    _load(Spell, spell_ids)                              # magic_reaction（spell_id 経由）
    # quest は直接 ref とアイデア経由（idea.quest_id）の両方。ideas は上で load 済み＝get は identity map ヒット
    quest_ids: list[uuid.UUID] = [n.ref_quest_id for n in rows]
    for n in rows:
        if n.ref_idea_id:
            idea = session.get(Idea, n.ref_idea_id)
            if idea:
                quest_ids.append(idea.quest_id)
    _load(Quest, quest_ids)


def get_for_recipient(session: Session, notif_id: uuid.UUID, recipient_id: uuid.UUID) -> Notification | None:
    """自分宛の1件（他人宛は None＝404 相当・IDOR 対策）。"""
    return session.execute(
        select(Notification).where(Notification.id == notif_id, Notification.recipient_id == recipient_id)
    ).scalars().first()


def list_for_recipient(
    session: Session,
    recipient_id: uuid.UUID,
    *,
    state: str = "all",
    types: list[str] | None = None,
    before: tuple[datetime, uuid.UUID] | None = None,
    limit: int = 30,
) -> tuple[list[Notification], bool]:
    """新着降順の一覧（§1.8）。`state=unread` は未読のみ・`types` は種別 in 絞り込み。

    返り値＝(rows, has_more)。has_more は limit+1 件取得で判定。
    """
    stmt = select(Notification).where(Notification.recipient_id == recipient_id)
    if state == "unread":
        stmt = stmt.where(Notification.is_read.is_(False))
    if types:
        stmt = stmt.where(Notification.type.in_(types))
    if before is not None:
        b_created, b_id = before
        stmt = stmt.where(
            (Notification.created_at < b_created)
            | ((Notification.created_at == b_created) & (Notification.id < b_id))
        )
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit + 1)
    rows = list(session.execute(stmt).scalars().all())
    has_more = len(rows) > limit
    return rows[:limit], has_more


def unread_count(session: Session, recipient_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count()).select_from(Notification).where(
                Notification.recipient_id == recipient_id, Notification.is_read.is_(False)
            )
        ).scalar_one()
    )


def mark_all_read(session: Session, recipient_id: uuid.UUID, *, types: list[str] | None = None) -> int:
    """自分宛の未読をすべて既読化（type 絞り込み可）。更新件数を返す。"""
    stmt = select(Notification).where(
        Notification.recipient_id == recipient_id, Notification.is_read.is_(False)
    )
    if types:
        stmt = stmt.where(Notification.type.in_(types))
    updated = 0
    for n in session.execute(stmt).scalars().all():
        n.is_read = True
        updated += 1
    return updated
