"""G 日次判定の純粋関数テスト（データモデル §7・§8-⑥／API設計 G.6）。

日境界は JST（Asia/Tokyo・UTC+9）固定。`created_at` は UTC 保存＝判定時に JST 換算する。
DB 非依存＝`app.tenant.gamification.daily`。
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.tenant.gamification.daily import jst_date, jst_day_bounds_utc, period_bounds_utc


def test_jst_date_crosses_at_15z():
    # 14:59:59Z＝JST 23:59:59（同日）／15:00:00Z＝JST 翌日 00:00
    assert jst_date(datetime(2026, 8, 19, 14, 59, 59, tzinfo=timezone.utc)) == datetime(2026, 8, 19).date()
    assert jst_date(datetime(2026, 8, 19, 15, 0, 0, tzinfo=timezone.utc)) == datetime(2026, 8, 20).date()


def test_jst_day_bounds_are_utc_halfopen_24h():
    # JST 2026-08-20 の一日＝UTC [2026-08-19T15:00Z, 2026-08-20T15:00Z)
    dt = datetime(2026, 8, 20, 3, 0, 0, tzinfo=timezone.utc)  # JST 12:00（20日）
    start, end = jst_day_bounds_utc(dt)
    assert start == datetime(2026, 8, 19, 15, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 8, 20, 15, 0, 0, tzinfo=timezone.utc)
    assert start <= dt < end


def test_same_jst_day_shares_bounds_across_utc_midnight():
    # UTC 日跨ぎ（23:00Z と翌01:00Z）でも JST では別日＝境界が異なることを担保
    late = datetime(2026, 8, 19, 23, 0, 0, tzinfo=timezone.utc)   # JST 8/20 08:00
    early = datetime(2026, 8, 20, 1, 0, 0, tzinfo=timezone.utc)   # JST 8/20 10:00
    assert jst_day_bounds_utc(late) == jst_day_bounds_utc(early)


def test_period_bounds_all_is_none():
    assert period_bounds_utc("all", datetime(2026, 8, 19, 3, 0, tzinfo=timezone.utc)) is None


def test_period_bounds_this_and_last_week():
    # 2026-08-19 は水曜（JST）。週起点＝月曜 2026-08-17 00:00 JST＝2026-08-16T15:00Z。
    now = datetime(2026, 8, 19, 3, 0, tzinfo=timezone.utc)  # JST 8/19 12:00（水）
    this_w = period_bounds_utc("this_week", now)
    assert this_w == (datetime(2026, 8, 16, 15, 0, tzinfo=timezone.utc),
                      datetime(2026, 8, 23, 15, 0, tzinfo=timezone.utc))
    last_w = period_bounds_utc("last_week", now)
    assert last_w == (datetime(2026, 8, 9, 15, 0, tzinfo=timezone.utc),
                      datetime(2026, 8, 16, 15, 0, tzinfo=timezone.utc))


def test_period_bounds_this_month():
    now = datetime(2026, 8, 19, 3, 0, tzinfo=timezone.utc)
    # 当月＝2026-08-01 00:00 JST〜2026-09-01 00:00 JST（UTC は前日 15:00Z）
    assert period_bounds_utc("this_month", now) == (
        datetime(2026, 7, 31, 15, 0, tzinfo=timezone.utc),
        datetime(2026, 8, 31, 15, 0, tzinfo=timezone.utc),
    )
