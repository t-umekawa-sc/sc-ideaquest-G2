"""日次判定の純粋関数（データモデル §7・§8-⑥／API設計 G.6）。

日次上限（ログイン/投票/チャット）と週境界は **JST（Asia/Tokyo）固定**で判定する（`created_at` は UTC
保存・判定時に JST 換算）。本モジュールは DB 非依存の純粋関数（level.py と同層・§3.1 functional core）。
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

JST = timezone(timedelta(hours=9))  # Asia/Tokyo 固定（§7・会社別 TZ は当面対象外）


def jst_date(dt: datetime) -> date:
    """UTC（または任意 tz-aware）日時を JST の暦日に落とす。"""
    return dt.astimezone(JST).date()


def jst_day_bounds_utc(dt: datetime) -> tuple[datetime, datetime]:
    """`dt` が属する JST 暦日の `[00:00, 翌00:00)` を UTC の半開区間で返す（日次存在チェック用）。"""
    day = jst_date(dt)
    start_jst = datetime.combine(day, time.min, tzinfo=JST)
    return start_jst.astimezone(timezone.utc), (start_jst + timedelta(days=1)).astimezone(timezone.utc)


def _jst_midnight_utc(d: date) -> datetime:
    """JST 暦日 `d` の 00:00 を UTC で返す。"""
    return datetime.combine(d, time.min, tzinfo=JST).astimezone(timezone.utc)


def period_bounds_utc(period: str, now: datetime) -> tuple[datetime, datetime] | None:
    """期間フィルタ（G.5 ランキング／G.6 履歴）を UTC 半開区間で返す。`all` は境界なし＝None。

    週起点＝月曜 00:00（JST 固定・§7）。`this_month`＝当月1日〜翌月1日。境界は JST で決め UTC 換算。
    """
    if period == "all":
        return None
    day = jst_date(now)
    if period == "this_week":
        monday = day - timedelta(days=day.weekday())  # 月曜=0
        return _jst_midnight_utc(monday), _jst_midnight_utc(monday + timedelta(days=7))
    if period == "last_week":
        monday = day - timedelta(days=day.weekday())
        return _jst_midnight_utc(monday - timedelta(days=7)), _jst_midnight_utc(monday)
    if period == "this_month":
        first = day.replace(day=1)
        next_first = (first.replace(day=28) + timedelta(days=4)).replace(day=1)  # 当月末+α→翌月1日
        return _jst_midnight_utc(first), _jst_midnight_utc(next_first)
    raise ValueError(f"unknown period: {period}")
