r"""SEC-TC-054: ILIKE 検索のワイルドカード安全化（AUDIT-019）。

`escape_like` が LIKE メタ文字（`% _ \`）をエスケープし、`like_contains` が `%<escaped>%` を返すこと
（`.ilike(pattern, escape="\\")` と対で全件/過大一致を防ぐ）を単体検証する。
"""
from __future__ import annotations

from app.core.sqlsearch import escape_like, like_contains


def test_sec_tc_054_escape_like_escapes_metachars():
    # バックスラッシュを最初に処理（二重エスケープ順序）。
    assert escape_like("a%_\\b") == "a\\%\\_\\\\b"
    # メタ文字が無ければそのまま。
    assert escape_like("hello") == "hello"
    # like_contains は前後 % で囲み、内側のメタ文字はエスケープ済み。
    assert like_contains("x%") == "%x\\%%"
    assert like_contains("a_b") == "%a\\_b%"
