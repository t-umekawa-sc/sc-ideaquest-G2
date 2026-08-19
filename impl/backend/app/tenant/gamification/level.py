"""ゲーミフィケーション G＝XP からレベル進捗を算出する純粋関数（データモデル §7）。

- Lv n→n+1 に必要な XP（増分）＝`100 + (n-1)×50`（§7・線形上昇）。`users.level` は `xp` 従属のキャッシュ。
- 本関数は総獲得 `xp` から `level`／現レベル内の必要量 `level_span`／次レベルまでの残り `xp_to_next` を算出する
  **DB 非依存の純粋関数**（K.1 の `GET /me` 残高・I.1 ダッシュボード hero が同形で利用）。
- 残高台帳の canonical は G の `activities`（K は `users` の残高を読むのみ・K.6）。レベル上限は設けない（§8-⑥）。
"""
from __future__ import annotations


def level_span(level: int) -> int:
    """Lv `level`→`level+1` に必要な XP（増分・§7）。level>=1 前提。"""
    return 100 + (level - 1) * 50


def level_progress(xp: int) -> dict:
    """総獲得 `xp` から `{level, xp_to_next, level_span}` を算出（§7・I.1 と同形）。

    `level`＝その xp で到達している最大レベル（Lv1 起点・上限なし）。
    `level_span`＝現レベル内の必要 XP。`xp_to_next`＝次レベルまでの残り XP。
    """
    remaining = xp if xp > 0 else 0
    level = 1
    while remaining >= level_span(level):
        remaining -= level_span(level)
        level += 1
    span = level_span(level)
    return {"level": level, "xp_to_next": span - remaining, "level_span": span}
