"""クライアント IP の確定（信頼プロキシ・ADR-0006）。純粋関数＝リクエスト非依存でテスト可能。"""
from __future__ import annotations


def resolve_client_ip(peer_ip: str, forwarded_for: str | None, trusted_proxy_count: int) -> str:
    """実クライアント IP を確定する（ADR-0006 §2.1）。

    `X-Forwarded-For`（`forwarded_for`）を右から `trusted_proxy_count` ホップ分だけ自陣の
    プロキシとみなし、その 1 つ外側（クライアント側）を実クライアント IP とする。
    左端固定取得はしない＝クライアントが XFF 先頭に注入した詐称値を無視できる。

    - `trusted_proxy_count <= 0`＝プロキシ無し（直アクセス/テスト）＝直近ピアをそのまま。
    - `chain = XFF をカンマ分割 + [直近ピア]`（右端＝直近ピア）。`idx = len(chain)-1-count`。
    - `idx < 0`（XFF が想定より短い＝設定過大 or 直アクセス）は安全側で最外（`chain[0]`）。
    """
    if trusted_proxy_count <= 0:
        return peer_ip
    chain = [h.strip() for h in (forwarded_for or "").split(",") if h.strip()]
    chain.append(peer_ip)
    idx = len(chain) - 1 - trusted_proxy_count
    return chain[idx] if idx >= 0 else chain[0]
