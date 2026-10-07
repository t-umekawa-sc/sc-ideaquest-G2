"""使い捨て（一時）メールドメイン判定（FR-48② SEC G・ローカル同梱 blocklist）。

外部サービスを使わず、同梱 `disposable_domains.txt`（公開リストのスターターセット）と照合する。
既定で有効（`signup_disposable_email_block=True`）＝ローカルで安全・外部呼び出しなし。
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings

_LIST_PATH = Path(__file__).with_name("disposable_domains.txt")


@lru_cache(maxsize=1)
def _domains() -> frozenset[str]:
    try:
        lines = _LIST_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return frozenset()
    return frozenset(
        d.strip().lower() for d in lines if d.strip() and not d.lstrip().startswith("#")
    )


def is_disposable(email: str) -> bool:
    """email のドメインが使い捨てリストに該当すれば True。無効設定時は False。"""
    if not get_settings().signup_disposable_email_block:
        return False
    at = email.rfind("@")
    if at < 0:
        return False
    domain = email[at + 1:].strip().lower()
    return domain in _domains()
