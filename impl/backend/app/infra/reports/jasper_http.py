"""Jasper レンダラ＝内部 Jasper サービスの `POST /render` を S2S で叩く（設計 §3/§4・API設計 V.2）。

**データ・プッシュ**＝`{report_key, format, data}` を JSON body で渡す（Jasper は我々のスキーマ/DB を知らない
純レンダラ）。認証＝`X-Report-Secret`。到達不能/失敗は `ReportUnavailable`（呼び出し側 502）。Jasper の URL は
固定 env（ユーザー入力由来にしない＝SSRF 回避・§17.5 軽微a）＋応答サイズ上限で DoS を緩和する。
"""
from __future__ import annotations

from app.infra.reports.errors import ReportUnavailable


class JasperHttpRenderer:
    """HTTP で Jasper サービスを呼ぶレンダラ（LLM の `OpenAICompatibleChat` と同じ薄アダプタ）。"""

    def __init__(self, *, base_url: str, secret: str = "", timeout: float = 30.0,
                 max_bytes: int = 25_000_000) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout
        self._max_bytes = max_bytes

    def render(self, report_key: str, data: dict, fmt: str) -> bytes:
        import httpx  # 遅延 import（テストは FakeRenderer 注入＝未接続）

        headers = {"Content-Type": "application/json"}
        if self._secret:
            headers["X-Report-Secret"] = self._secret
        url = f"{self._base_url}/render"
        body = {"report_key": report_key, "format": fmt, "data": data}
        try:
            resp = httpx.post(url, json=body, headers=headers, timeout=self._timeout)
            resp.raise_for_status()
            content = resp.content
        except Exception as exc:  # noqa: BLE001（到達不能/HTTP エラーはまとめて Unavailable へ＝502）
            raise ReportUnavailable(str(exc)) from exc
        if len(content) > self._max_bytes:  # 応答サイズ上限（DoS 緩和・§17.5 軽微a）
            raise ReportUnavailable("report response exceeds size limit")
        return content
