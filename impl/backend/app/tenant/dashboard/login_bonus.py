"""デイリーログインボーナスのワンショット提示フラグ（I.1・A.1/G.6）。

XP 付与自体は G（`grant_daily_login`・元帳が canonical）。ここは**演出を1回だけ出す**ための Redis ワンショット。
A（ログイン成功＝新 JST 日の初回）が付与時に `mark` し、I（`GET /dashboard`）が `consume`（GETDEL）で一度だけ返す
（多重表示を防ぐ）。真実は元帳＝これは表示用の速報フラグ（消えても付与は消えない）。
"""
from __future__ import annotations

import uuid

import redis


def _key(user_id: uuid.UUID | str) -> str:
    return f"dashboard:login_bonus:{user_id}"


def mark(r: redis.Redis, user_id: uuid.UUID | str, xp: int) -> None:
    """当日初回ログイン XP 付与時に立てる（24h TTL・当日中に消費される想定）。best-effort。"""
    try:
        r.set(_key(user_id), int(xp), ex=86400)
    except Exception:  # noqa: BLE001 — 演出フラグ。本処理（ログイン）を壊さない。
        pass


def consume(r: redis.Redis, user_id: uuid.UUID | str) -> dict | None:
    """未消費なら `{xp}` を返し、同時に消す（GETDEL・多重表示防止）。無ければ None。"""
    try:
        raw = r.getdel(_key(user_id))
    except Exception:  # noqa: BLE001
        return None
    if raw is None:
        return None
    try:
        return {"xp": int(raw)}
    except (TypeError, ValueError):
        return None
