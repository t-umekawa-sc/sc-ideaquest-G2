"""CAPTCHA 検証（Cloudflare Turnstile・FR-48② SEC G）。

Turnstile はトークン発行時に Cloudflare 側でボット判定を行い、その結果を単回トークンに埋め込む。
本 `siteverify` は secret key で**トークンの真正性（未使用/未失効/自サイト発行）＋ボット判定通過**を
サーバー側で確認する（偽造・再利用を弾く）。

secret 未設定なら無効＝常に True（dev/CI/テストはスキップ＝既存挙動を壊さない）。prod で
env `TURNSTILE_SECRET_KEY`（＋フロントの `TURNSTILE_SITE_KEY`）を設定して有効化。
検証不能（トークン無/不正/外部障害）は **False（fail-closed）**＝人間と確認できなければ拒否
（CAPTCHA の目的＝ボット遮断を優先。Turnstile は Cloudflare エッジで可用性が高い）。
"""
from __future__ import annotations

import httpx

from app.core.config import get_settings

_SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def captcha_enabled() -> bool:
    return bool(get_settings().turnstile_secret_key)


def verify_turnstile(token: str | None, ip: str | None) -> bool:
    """Turnstile トークンを検証。secret 未設定は True（スキップ）。無/不正/障害は False（fail-closed）。"""
    s = get_settings()
    if not s.turnstile_secret_key:
        return True  # 無効＝スキップ
    if not token:
        return False
    try:
        resp = httpx.post(
            _SITEVERIFY,
            data={"secret": s.turnstile_secret_key, "response": token, "remoteip": ip or ""},
            timeout=s.turnstile_timeout_seconds,
        )
        if resp.status_code != 200:
            return False
        return bool(resp.json().get("success"))
    except (httpx.HTTPError, ValueError):
        return False
