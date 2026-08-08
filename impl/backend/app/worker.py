"""outbox ワーカの起動点（別プロセス・§3.4）。

`account_sync_outbox`（管理DB→会社DB のミラー反映・API設計 §1.13）を処理する常駐ワーカ。
**両プレーンを跨ぐ唯一の実行主体**。identity 同期（B/K）スライスで実装する。
現状は未実装のプレースホルダ（起動しても何もせず終了）。
"""
from __future__ import annotations


def main() -> None:
    raise SystemExit("outbox worker is not implemented yet (B/K identity-sync slice)")


if __name__ == "__main__":
    main()
