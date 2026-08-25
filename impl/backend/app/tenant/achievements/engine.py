"""実績の判定エンジン（G.4・§8-⑲）＝台帳（activities）追記フックで即時判定・冪等。

`evaluate` は `ledger.grant` の後フックから呼ばれ、当該 reason/kind に関連する実績のみ再判定して進捗を更新、
達成なら `user_achievements` を確定＋ティア連動コインを付与（reason=achievement_reward・exists_ref 冪等）。
`compute` は GET（表示）でも読み取り専用に使う。condition 種別＝count/streak_login/level/all_spells/all_items。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.tenant.achievements import repository as repo
from app.tenant.chat import repository as chat_repo
from app.tenant.gamification import ledger
from app.tenant.gamification import repository as gami_repo
from app.tenant.shop import repository as shop_repo

_JST = timezone(timedelta(hours=9))


def compute(session, user, ach) -> tuple[int, int | None, bool]:
    """実績の進捗を算出（読み取り専用）＝(current, target, met)。"""
    c = ach.condition or {}
    t = c.get("type")
    if t == "count":
        cur = gami_repo.count_reason(session, user.id, c.get("reason", ""))
        target = int(c.get("target", ach.target_value or 0))
        return cur, target, cur >= target
    if t == "level":
        target = int(c.get("target", ach.target_value or 0))
        return int(user.level), target, int(user.level) >= target
    if t == "streak_login":
        cur = _login_streak(session, user.id)
        target = int(c.get("target", ach.target_value or 0))
        return cur, target, cur >= target
    if t == "all_spells":
        owned = len(chat_repo.list_user_spell_ids(session, user.id))
        total = len(chat_repo.list_spells(session))
        return owned, total, total > 0 and owned >= total
    if t == "all_items":
        owned = len(shop_repo.list_user_items(session, user.id))
        total = len(shop_repo.list_items(session))
        return owned, total, total > 0 and owned >= total
    return 0, ach.target_value, False


def _login_streak(session, user_id) -> int:
    """連続ログイン日数（JST 日・reason=login の日付連続・§7）。今日 or 昨日から遡って連続数。"""
    dates = sorted({d.astimezone(_JST).date() for d in gami_repo.login_dates(session, user_id)}, reverse=True)
    if not dates:
        return 0
    today = datetime.now(_JST).date()
    if dates[0] not in (today, today - timedelta(days=1)):
        return 0  # 直近ログインが一昨日以前＝ストリーク途切れ
    streak = 1
    for i in range(1, len(dates)):
        if dates[i] == dates[i - 1] - timedelta(days=1):
            streak += 1
        else:
            break
    return streak


def _relevant(ach, reason: str, kind: str) -> bool:
    """当該付与（reason/kind）で再判定すべき実績か（reason ルーティング・G.4）。"""
    c = ach.condition or {}
    t = c.get("type")
    if t == "count":
        return c.get("reason") == reason
    if t == "level":
        return kind == ledger.XP_GAIN  # XP 変動でレベルが動く
    if t == "streak_login":
        return reason == "login"
    if t == "all_spells":
        return reason == "spell_unlock"
    if t == "all_items":
        return reason == "shop_purchase"
    return False


def evaluate(session, user, reason: str, kind: str) -> None:
    """台帳追記後フック＝当該 reason/kind に関連する未獲得実績を再判定し、達成なら確定＋報酬。"""
    owned = repo.list_user_achievements(session, user.id)
    for ach in repo.list_achievements(session):
        if not _relevant(ach, reason, kind):
            continue
        ua = owned.get(ach.id)
        if ua is not None and ua.unlocked_at is not None:
            continue  # 獲得済み＝冪等
        cur, target, met = compute(session, user, ach)
        ua = repo.upsert_user_achievement(session, user.id, ach.id, current=cur, target=target)
        if met and ua.unlocked_at is None:
            ua.unlocked_at = datetime.now(timezone.utc)
            # ティア連動コイン報酬（冪等＝exists_ref）。judge=False で再帰させない。
            if not gami_repo.exists_ref(session, user.id, ledger.COIN_GAIN, "achievement_reward", "achievements", ach.id):
                ledger.grant(session, user, kind=ledger.COIN_GAIN, amount=ach.coin_reward, reason="achievement_reward",
                             ref_type="achievements", ref_id=ach.id, judge=False)
            _notify_achievement(session, user, ach)


def _notify_achievement(session, user, ach) -> None:
    """実績獲得通知（notification_type=achievement・本人宛・H.0）。

    実績付与は grant の同一 UoW 内なので通知も同セッションで生成（post-commit ではなく in-session＝
    達成とセットで確定・取りこぼしなし）。params にティア/コインを凍結（H.1・meta 用）。
    """
    from app.tenant.notifications import service as notify_svc

    notify_svc.notify(session, [notify_svc.entry(
        user.id, "achievement",
        refs={"ref_achievement_id": ach.id},
        params={"tier": ach.tier, "coin": ach.coin_reward},
    )])
