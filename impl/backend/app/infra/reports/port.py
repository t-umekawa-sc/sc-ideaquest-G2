"""レンダラ port＝`ReportRenderer`（描画の抽象）。帳票データ組み立て（domain）はこの IF だけに依存する。

実装は `JasperHttpRenderer`（HTTP で Jasper を呼ぶ）／`FallbackPdfRenderer`（純 Python）／テストの `FakeRenderer`。
`data` は **JSON シリアライズ可能な dict**（データ・プッシュ＝Jasper へそのまま JSON body で渡す・設計 §4）。
"""
from __future__ import annotations

from typing import Protocol


class ReportRenderer(Protocol):
    """帳票1枚を描画してバイト列を返す最小 IF（LLM の `ChatClient` と同じ立ち位置）。

    - `report_key`＝テンプレート論理キー（ホワイトリスト解決済み・registry）。レンダラは物理テンプレを解決する。
    - `data`＝印字データ（JSON 可の dict）。`fmt`＝出力形式（`pdf` 等）。
    - 到達不能/描画失敗は `ReportUnavailable`。未対応キー/形式は `ReportConfigError`。
    """

    def render(self, report_key: str, data: dict, fmt: str) -> bytes: ...
