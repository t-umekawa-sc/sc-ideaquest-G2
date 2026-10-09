"""帳票基盤の例外（呼び出し側＝application が HTTP ステータスへ写像する）。

- `ReportConfigError`＝`report_key` が未知/不正（パストラバーサル入力含む・R5）→ application は 422/500 系で弾く。
- `ReportUnavailable`＝レンダラ（Jasper）に到達できない/描画失敗 → application は 502（再試行可）へ。
LLM 基盤の `LLMConfigError`/`LLMUnavailable`（gateway.py）と同じ役割分担。
"""
from __future__ import annotations


class ReportConfigError(ValueError):
    """帳票設定/キーが不正（未知 report_key・ホワイトリスト外・未対応 format）。"""


class ReportUnavailable(RuntimeError):
    """レンダラに到達できない/描画に失敗（呼び出し側は 502・再試行可メッセージ）。"""
