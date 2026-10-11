"""部分一致検索（ILIKE）のワイルドカード安全化ヘルパ（AUDIT-019）。

利用者入力の検索語に含まれる LIKE メタ文字（`% _ \\`）をエスケープし、`escape='\\'` 付きの
`ILIKE` 条件を組む。エスケープしないと `%`/`_` が全件/過大一致として作用する（SQLi ではない＝
値はバインドされるが、検索セマンティクス崩れ・大規模テーブルでの重いスキャン）。

使い方:
    conds.append(ilike_contains(Model.title, q))
    # 複数列は or_(ilike_contains(A.x, q), ilike_contains(B.y, q))
"""
from __future__ import annotations


def escape_like(term: str) -> str:
    """LIKE/ILIKE のメタ文字をエスケープ（`escape='\\'` と対で使う）。`\\` を先に置換すること。"""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def like_contains(term: str) -> str:
    """部分一致パターン `%<escaped>%` を返す（`.ilike(pattern, escape='\\')` と併用）。"""
    return f"%{escape_like(term)}%"


def ilike_contains(column, term: str):
    """`column ILIKE '%<escaped term>%' ESCAPE '\\'` の条件式を返す（ワイルドカード無害化・AUDIT-019）。"""
    return column.ilike(like_contains(term), escape="\\")
