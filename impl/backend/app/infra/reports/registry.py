"""帳票テンプレートのホワイトリスト解決（R5）＋レンダラ選択（env・着脱）。

- **`report_key` ホワイトリスト**＝クライアント入力からパスを組み立てない（`../` 等のパストラバーサル防止）。
  許可キーのみ通し、未知は `ReportConfigError`。Jasper 側も `reports/{key}.jrxml` を多層防御で再検証する。
- **レンダラ選択**＝`REPORT_RENDERER=jasper|fallback|none`。`none` は None を返し、application が 503 へ写像
  （機能オフ＝フロントはボタン非活性）。テストは `set_renderer(FakeRenderer)` で差し替え（gateway の
  `set_chat_client` と同作法）。
"""
from __future__ import annotations

from app.core.config import get_settings
from app.infra.reports.errors import ReportConfigError
from app.infra.reports.port import ReportRenderer

# 許可テンプレート（論理 report_key の集合）。Jasper サービス内 `reports/{key}.jrxml` にマップされる。
_TEMPLATES: frozenset[str] = frozenset({"company_usage_invoice"})

# 許可出力形式（初期は pdf のみ・将来 xlsx/csv）。未対応は application が 422 unsupported_format。
SUPPORTED_FORMATS: frozenset[str] = frozenset({"pdf"})


def resolve_template(report_key: str) -> str:
    """`report_key` をホワイトリストで検証して返す（R5・パストラバーサル入力は拒否）。"""
    if report_key not in _TEMPLATES:
        raise ReportConfigError(f"unknown report_key: {report_key!r}")
    return report_key


_override: ReportRenderer | None = None


def set_renderer(renderer: ReportRenderer | None) -> None:
    """レンダラを差し替える（None で既定＝env 解決へ戻す）。テストは FakeRenderer を注入。"""
    global _override
    _override = renderer


def get_renderer() -> ReportRenderer | None:
    """現在のレンダラを返す（`none` または未知モードは None＝機能オフ→application が 503）。

    注入（`set_renderer`）があれば env に優先。本番/開発は env（`REPORT_RENDERER`）から遅延生成する。
    """
    if _override is not None:
        return _override
    mode = (get_settings().report_renderer or "none").lower()
    if mode == "jasper":
        from app.infra.reports.jasper_http import JasperHttpRenderer

        s = get_settings()
        return JasperHttpRenderer(
            base_url=s.jasper_base_url, secret=s.jasper_shared_secret,
            timeout=s.jasper_timeout_seconds, max_bytes=s.jasper_max_response_bytes,
        )
    if mode == "fallback":
        from app.infra.reports.fallback_pdf import FallbackPdfRenderer

        return FallbackPdfRenderer()
    return None  # none / 未知 → 機能オフ
