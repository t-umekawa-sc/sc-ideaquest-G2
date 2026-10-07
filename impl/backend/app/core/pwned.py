"""漏洩パスワード判定（HIBP Pwned Passwords range API・FR-48② SEC D）。

k-匿名性＝PW の SHA-1（40hex）の**先頭5文字だけ**を送る（20bit＝数百〜千候補に一致＝PW特定不可）。
レスポンスの suffix:count 一覧を**ローカルで照合**＝PW平文もフルハッシュも外部に出ない。`Add-Padding: true`
でレスポンスを水増しし、サイズからの推測も防ぐ（水増し行は count=0）。TLS 経由。

既定は無効（`hibp_enabled=False`）＝dev/test は外部を叩かない。prod で env `HIBP_ENABLED=true`。
外部障害/タイムアウト時は **fail-open（漏洩ではない扱いで通す）**＝HIBP ダウンでサインアップ全停止を避ける
（可用性優先・運用判断）。厳格運用が要れば呼び出し側で扱いを変える。
"""
from __future__ import annotations

import hashlib

import httpx

from app.core.config import get_settings

_RANGE_URL = "https://api.pwnedpasswords.com/range/"


def is_pwned_password(password: str) -> bool:
    """漏洩が確認できれば True。無効設定／外部障害／タイムアウトは False（fail-open）。"""
    s = get_settings()
    if not s.hibp_enabled:
        return False
    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()  # noqa: S324（PW判定用途・HIBP仕様）
    prefix, suffix = sha1[:5], sha1[5:]
    try:
        resp = httpx.get(
            f"{_RANGE_URL}{prefix}",
            headers={"Add-Padding": "true", "User-Agent": "ideaquest-signup"},
            timeout=s.hibp_timeout_seconds,
        )
        if resp.status_code != 200:
            return False  # fail-open
        body = resp.text
    except httpx.HTTPError:
        return False  # fail-open（外部障害でサインアップ全停止を避ける・SEC D）
    for line in body.splitlines():
        parts = line.split(":")
        if len(parts) == 2 and parts[0].strip().upper() == suffix:
            try:
                return int(parts[1].strip()) > 0  # Add-Padding の水増し行は count=0
            except ValueError:
                return False
    return False
