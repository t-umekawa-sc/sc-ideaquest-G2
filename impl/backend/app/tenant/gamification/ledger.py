"""ゲーミフィケーション台帳サービス（G の canonical・データモデル §7／API設計 G.0）。

**残高の唯一の書き込み口**。付与/消費は必ず `activities` 追記＋`users` 残高更新を**同一Tx**で行う
（元帳と残高キャッシュの乖離を防ぐ・§7 実装方針）。XP 付与ではレベルを再計算し、上昇分だけ
`levelup_sp` を発行する（§7・SP+1/Lv・上限なし）。冪等は呼び出し側（参照単位 or 日次）で判定する。

本スライスの利用は**ログイン XP（G.6 login・+10/JST日・ユーザー×日で1回）**のみ。投票/投稿/評価/
購入/解放（他ドメインの発火・spend 系）は後続スライスで本サービスを共用する。commit は呼び出し側。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.tenant.gamification import repository as repo
from app.tenant.gamification.daily import jst_day_bounds_utc
from app.tenant.gamification.level import level_progress
from app.tenant.gamification.orm import Activity
from app.tenant.profile.orm import User

# activity_kind（§3）
XP_GAIN = "xp_gain"
COIN_GAIN = "coin_gain"
COIN_SPEND = "coin_spend"
SP_GAIN = "sp_gain"
SP_SPEND = "sp_spend"

LOGIN_XP = 10  # §7 ログイン XP（初期値・調整可）


def _apply_balance(user: User, kind: str, amount: int) -> None:
    """kind に応じて残高キャッシュを増減（amount は常に正・方向は kind・§5.27）。"""
    if kind == XP_GAIN:
        user.xp += amount
    elif kind == COIN_GAIN:
        user.coin_balance += amount
    elif kind == COIN_SPEND:
        user.coin_balance -= amount
    elif kind == SP_GAIN:
        user.skill_point_balance += amount
    elif kind == SP_SPEND:
        user.skill_point_balance -= amount
    else:  # 未知の kind は台帳/残高を壊すので明示的に弾く
        raise ValueError(f"unknown activity kind: {kind}")


def _append(session: Session, user_id: uuid.UUID, kind: str, amount: int, reason: str,
            *, ref_type: str | None = None, ref_id: uuid.UUID | None = None,
            quest_id: uuid.UUID | None = None) -> Activity:
    return repo.add(session, Activity(
        id=uuid.uuid4(), user_id=user_id, kind=kind, amount=amount, reason=reason,
        ref_type=ref_type, ref_id=ref_id, quest_id=quest_id,
    ))


def _settle_levelups(session: Session, user: User) -> None:
    """`user.xp` からレベルを再計算し、上昇分だけ `levelup_sp`（SP+1/Lv）を記帳（§7）。"""
    new_level = level_progress(user.xp)["level"]
    for _ in range(new_level - user.level):  # 一度の付与で複数段上がり得る（各段 SP+1・§7）
        _append(session, user.id, SP_GAIN, 1, "levelup_sp")
        user.skill_point_balance += 1
    user.level = new_level


def grant(session: Session, user: User, *, kind: str, amount: int, reason: str,
          ref_type: str | None = None, ref_id: uuid.UUID | None = None,
          quest_id: uuid.UUID | None = None) -> Activity:
    """`activities` 追記＋残高更新を同一 UoW で実行（commit は呼び出し側）。

    XP 付与時はレベルを再計算し `levelup_sp` を連動発行する。冪等判定は呼び出し側の責務。
    """
    activity = _append(session, user.id, kind, amount, reason,
                       ref_type=ref_type, ref_id=ref_id, quest_id=quest_id)
    _apply_balance(user, kind, amount)
    if kind == XP_GAIN:
        _settle_levelups(session, user)
    return activity


def grant_daily_login(session: Session, user: User, *, now: datetime) -> Activity | None:
    """ログイン XP（G.6 login）を**ユーザー×JST日で1回**付与（既付与なら no-op で None）。

    付与契機＝「新しい JST 日の最初の認証済みリクエスト」（本スライスはログイン成功時に呼ぶ）。冪等は
    その JST 日に `reason='login'` の付与が無いことの存在チェック（§5.27・投票 XP と同流儀）。
    """
    start, end = jst_day_bounds_utc(now)
    if repo.exists_reason_between(session, user.id, "login", start, end):
        return None
    return grant(session, user, kind=XP_GAIN, amount=LOGIN_XP, reason="login")
