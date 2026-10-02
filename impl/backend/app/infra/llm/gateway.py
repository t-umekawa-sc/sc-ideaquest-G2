"""LLMゲートウェイ＝OpenAI 互換 `/chat/completions` を叩く自前の薄い層（FR-45・設計 §3）。

**位置づけ**＝ドメイン各機能は `task_type`＋メッセージを渡して補完結果を受け取るだけ。どの LLM が動くか
（provider/base_url/物理モデル）は registry（§3.4）に閉じ、機能側には**論理モデルキー**しか露出しない。
埋め込み（embeddings.py）と同じ「物理は基盤側・キーは論理・Fake 注入でテスト」流儀を踏襲する。

**差し替え**＝`set_chat_client()` でテスト用 `FakeChat`（決定的・外部未接続）を注入できる。本番/開発は
`OpenAICompatibleChat`（base_url/api_key/timeout は config・env で可変）。将来 provider 追加は本層に薄い
アダプタを足すだけ（`anthropic` 等・設計 §3.1）。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.config import get_settings
from app.infra.llm import registry


@dataclass
class LLMResult:
    """補完結果＝本文＋利用量（課金メータリング）＋実行に使った物理（監査）。"""

    text: str
    input_tokens: int
    output_tokens: int
    provider: str
    model: str
    finish_reason: str = "stop"


class ChatClient(Protocol):
    """OpenAI 互換 chat の最小 IF。model は物理モデル名（registry が解決した結果）。"""

    def complete(
        self,
        messages: list[dict],
        *,
        model: str,
        params: dict | None = None,
        timeout: float | None = None,
    ) -> LLMResult: ...


class LLMUnavailable(RuntimeError):
    """LLM サーバに到達できない/失敗（呼び出し側はリトライ or failed へ・設計 §5.4）。"""


class LLMConfigError(ValueError):
    """論理モデルキーが不正/無効（呼び出し側で 422 に写像・設計 §3.4 ガードレール）。"""


class OpenAICompatibleChat:
    """OpenAI 互換 `/chat/completions`（Ollama・vLLM・その他）を叩く実クライアント。"""

    def __init__(self, *, base_url: str, api_key: str = "", timeout: float = 120.0, max_tokens: int = 0) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._max_tokens = max_tokens  # >0 で生成トークン上限を付与（暴走抑止・dev 完走用。既定0=無制限）

    def complete(
        self,
        messages: list[dict],
        *,
        model: str,
        params: dict | None = None,
        timeout: float | None = None,
    ) -> LLMResult:
        import httpx  # 遅延 import（テストは Fake 注入＝未接続）

        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        body = {"model": model, "messages": messages, "stream": False}
        if params:
            body.update(params)
        # 会社別 max_tokens（params）が無ければグローバル上限を技術ガードとして付与（>0 のときのみ）。
        if self._max_tokens > 0 and "max_tokens" not in body:
            body["max_tokens"] = self._max_tokens
        try:
            resp = httpx.post(
                f"{self._base_url}/chat/completions",
                json=body,
                headers=headers,
                timeout=timeout or self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # noqa: BLE001（到達不能/形式不正はまとめて Unavailable へ）
            raise LLMUnavailable(str(exc)) from exc
        choice = (data.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content", "") or ""
        usage = data.get("usage") or {}
        return LLMResult(
            text=text,
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
            provider="openai_compat",
            model=model,
            finish_reason=choice.get("finish_reason", "stop") or "stop",
        )


class FakeChat:
    """テスト用＝決定的な補完（外部未接続）。要約系は入力の先頭文＋定型で返し、tokens は語数で近似する。

    目的＝enqueue→worker→gateway→result の縦配線を、外部 LLM 無しで決定的に検証できるようにする
    （embeddings.py の FakeEmbeddings と同方針）。厳密な生成品質ではなくテストの意図を満たす近似。
    """

    def complete(
        self,
        messages: list[dict],
        *,
        model: str,
        params: dict | None = None,
        timeout: float | None = None,
    ) -> LLMResult:
        user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
        head = (user or "").strip().split("\n", 1)[0][:80]
        text = f"[要約] {head}" if head else "[要約]"
        in_tok = sum(len((m.get("content") or "").split()) for m in messages)
        out_tok = max(1, len(text.split()))
        return LLMResult(
            text=text,
            input_tokens=in_tok,
            output_tokens=out_tok,
            provider="openai_compat",
            model=model,
            finish_reason="stop",
        )


_client: ChatClient | None = None


def set_chat_client(client: ChatClient | None) -> None:
    """chat クライアントを差し替える（None で既定へ戻す）。テストは FakeChat を注入。"""
    global _client
    _client = client


def get_chat_client() -> ChatClient:
    """現在の chat クライアント（未設定なら config から OpenAI 互換を遅延生成）。"""
    global _client
    if _client is None:
        s = get_settings()
        _client = OpenAICompatibleChat(
            base_url=s.llm_base_url, api_key=s.llm_api_key, timeout=s.llm_timeout_seconds,
            max_tokens=s.llm_max_tokens,
        )
    return _client


def complete(
    task_type: str,
    messages: list[dict],
    *,
    model: str | None = None,
    params: dict | None = None,
    timeout: float | None = None,
) -> LLMResult:
    """補完を実行する（ドメインが知る唯一の口）。

    論理キーを解決（明示 model ＞ task_type 既定 ＞ グローバル既定・設計 §3.4）→物理へ写像→クライアント呼び出し。
    不正/無効キーは `LLMConfigError`（呼び出し側で 422）。到達不能は `LLMUnavailable`（リトライ/failed）。
    """
    spec = registry.resolve(task_type, model)
    merged = dict(spec.params or {})
    if params:
        merged.update(params)
    result = get_chat_client().complete(
        messages, model=spec.model, params=merged or None, timeout=timeout
    )
    # provider は解決結果を正とする（クライアントの自己申告に依存しない・監査）。
    result.provider = spec.provider
    return result
