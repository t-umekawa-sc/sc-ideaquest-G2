"""会社DB ゲーミフィケーション元帳（activities）の参照・追記（テナントプレーン）。

クエリ/永続は本 repository に閉じ込め、UoW（残高整合）は `ledger` が担う（§3.4 4層）。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app.tenant.gamification.orm import Activity


def add(session: Session, activity: Activity) -> Activity:
    session.add(activity)
    return activity


def aggregate_ranking(
    session: Session, *, start: datetime | None, end: datetime | None, quest_id: uuid.UUID | None = None
) -> list[tuple]:
    """ランキング集計（G.5・§7）＝ユーザー別の 獲得XP／獲得コイン（期間内）＋期間内初回付与時刻。

    score は application 側で `xp+coin`。SP は対象外（kind を xp_gain/coin_gain に限定）。
    `quest_id` 指定でクエスト内（`activities.quest_id`）。返り値＝[(user_id, xp, coin, first_at)]。
    """
    xp = func.coalesce(func.sum(Activity.amount).filter(Activity.kind == "xp_gain"), 0).label("xp")
    coin = func.coalesce(func.sum(Activity.amount).filter(Activity.kind == "coin_gain"), 0).label("coin")
    stmt = (
        select(Activity.user_id, xp, coin, func.min(Activity.created_at).label("first_at"))
        .where(Activity.kind.in_(("xp_gain", "coin_gain")))
        .group_by(Activity.user_id)
    )
    if start is not None:
        stmt = stmt.where(Activity.created_at >= start)
    if end is not None:
        stmt = stmt.where(Activity.created_at < end)
    if quest_id is not None:
        stmt = stmt.where(Activity.quest_id == quest_id)
    return [(uid, int(x), int(c), fa) for uid, x, c, fa in session.execute(stmt).all()]


def exists_reason_between(
    session: Session, user_id: uuid.UUID, reason: str, start: datetime, end: datetime
) -> bool:
    """`user_id` に `reason` の付与が半開区間 `[start, end)` に既にあるか（日次冪等判定・§5.27）。"""
    stmt = (
        select(func.count())
        .select_from(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.reason == reason,
            Activity.created_at >= start,
            Activity.created_at < end,
        )
    )
    return session.execute(stmt).scalar_one() > 0


def count_reason_between(
    session: Session, user_id: uuid.UUID, reason: str, start: datetime, end: datetime
) -> int:
    """`user_id` の `reason` 付与件数を半開区間 `[start, end)` で数える（日次上限判定・チャット XP 等・§8-⑥）。"""
    return int(session.execute(
        select(func.count()).select_from(Activity).where(
            Activity.user_id == user_id,
            Activity.reason == reason,
            Activity.created_at >= start,
            Activity.created_at < end,
        )
    ).scalar_one())


def list_activities(
    session: Session, user_id: uuid.UUID, *,
    kind: str | None = None,
    bounds: tuple[datetime, datetime] | None = None,
    cursor: tuple[datetime, uuid.UUID] | None = None,
    limit: int,
) -> list[Activity]:
    """`user_id` の活動履歴を新しい順（created_at desc, id desc）でキーセット取得（G.6・§1.8）。

    `kind`／`bounds`（期間 [start, end)）で絞り込み、`cursor`＝(created_at, id) より古い行のみ返す。
    呼び出し側は `limit+1` を要求して has_next を判定する。
    """
    stmt = select(Activity).where(Activity.user_id == user_id)
    if kind is not None:
        stmt = stmt.where(Activity.kind == kind)
    if bounds is not None:
        stmt = stmt.where(Activity.created_at >= bounds[0], Activity.created_at < bounds[1])
    if cursor is not None:
        # (created_at, id) の行値比較で決定的なキーセット境界（desc 順＝カーソルより小さいタプル）
        stmt = stmt.where(tuple_(Activity.created_at, Activity.id) < tuple_(cursor[0], cursor[1]))
    stmt = stmt.order_by(Activity.created_at.desc(), Activity.id.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def exists_ref(
    session: Session, user_id: uuid.UUID, kind: str, reason: str,
    ref_type: str | None, ref_id: uuid.UUID | None,
) -> bool:
    """`(user_id, kind, reason, ref_type, ref_id)` の付与が既にあるか（参照単位の冪等・投票 XP 方式・§7）。"""
    stmt = (
        select(func.count())
        .select_from(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.kind == kind,
            Activity.reason == reason,
            Activity.ref_type == ref_type,
            Activity.ref_id == ref_id,
        )
    )
    return session.execute(stmt).scalar_one() > 0


def get_ref_activity(
    session: Session, user_id: uuid.UUID, kind: str, reason: str,
    ref_type: str | None, ref_id: uuid.UUID | None,
) -> Activity | None:
    """`(user_id, kind, reason, ref_type, ref_id)` の付与行を取得（確定額/日時の参照用・高々1件）。"""
    return session.execute(
        select(Activity).where(
            Activity.user_id == user_id,
            Activity.kind == kind,
            Activity.reason == reason,
            Activity.ref_type == ref_type,
            Activity.ref_id == ref_id,
        )
    ).scalars().first()
