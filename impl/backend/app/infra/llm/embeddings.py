"""埋め込み（テキスト→ベクトル）クライアント＝LLM 基盤の OpenAI 互換 `/embeddings` を叩く薄い層（A-2・FR-44）。

**位置づけ**＝意味的一致（整合率）の入力ベクトルを得るだけの最小 seam。モデルは基盤側（Ollama/vLLM 等）に置き、
backend アプリには焼き込まない（データ主権・横断集約＝ローカルLLM連携設計の精神）。将来のフル LLM ゲートウェイが
この関数をそのまま吸収できるよう、入出力は「テキスト群→ベクトル群」に限定する。

**差し替え**＝`app.infra.storage` と同流儀で `set_embeddings_client()` によりテスト用 Fake を注入できる
（決定的・外部未接続）。本番/開発は `OpenAICompatibleEmbeddings`（base_url/model は config・env で可変）。
"""
from __future__ import annotations

import hashlib
import math
from typing import Protocol

from app.core.config import get_settings


class EmbeddingsClient(Protocol):
    """テキスト群を同一次元のベクトル群へ写像する（順序対応）。model は現在の埋め込みモデル名。"""

    @property
    def model(self) -> str: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class EmbeddingsUnavailable(RuntimeError):
    """埋め込みサーバに到達できない/失敗（呼び出し側は keyword フォールバックへ）。"""


class OpenAICompatibleEmbeddings:
    """OpenAI 互換 `/embeddings`（Ollama・vLLM・その他）を叩く実クライアント。"""

    def __init__(self, *, base_url: str, model: str, api_key: str = "", timeout: float = 15.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._timeout = timeout

    @property
    def model(self) -> str:
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        import httpx  # 遅延 import（テストは Fake 注入＝未接続）
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        try:
            resp = httpx.post(
                f"{self._base_url}/embeddings",
                json={"model": self._model, "input": texts},
                headers=headers,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()["data"]
        except Exception as exc:  # noqa: BLE001（到達不能/形式不正はまとめてフォールバックへ）
            raise EmbeddingsUnavailable(str(exc)) from exc
        # OpenAI 形式＝data[i].embedding。index 順に並べ直す（サーバが順不同を返す可能性に備える）。
        ordered = sorted(data, key=lambda d: d.get("index", 0))
        return [[float(x) for x in d["embedding"]] for d in ordered]


class FakeEmbeddings:
    """テスト用＝決定的ハッシュ埋め込み（外部未接続）。同義語辞書で「意味的に近い語」を同じ次元に寄せる。

    目的＝キーワード cosine では 0 になる「語は違うが意味が近い」ペアで、埋め込みが高い cosine を返すことを
    決定的に検証できるようにする（実モデルの代役）。厳密な意味理解ではなく、テストの意図を満たす近似。
    """

    DIM = 16

    # 同義グループ＝同じ「意味ベクトルの山」に寄せる（実モデルの意味的近接の代役）。
    _SYNONYMS = {
        "太陽光": "再生可能エネルギー", "再エネ": "再生可能エネルギー", "脱炭素": "再生可能エネルギー",
        "パネル": "再生可能エネルギー",
        "人材": "組織開発", "育成": "組織開発", "研修": "組織開発",
    }

    def __init__(self, model: str = "fake-embed") -> None:
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def _vec(self, text: str) -> list[float]:
        acc = [0.0] * self.DIM
        for raw in (text or "").split():
            tok = self._SYNONYMS.get(raw, raw)  # 同義語は代表語へ寄せる＝意味的近接
            h = hashlib.sha256(tok.encode("utf-8")).digest()
            for i in range(self.DIM):
                acc[i] += (h[i] / 255.0) - 0.5
        norm = math.sqrt(sum(v * v for v in acc))
        return [v / norm for v in acc] if norm else acc


_client: EmbeddingsClient | None = None


def set_embeddings_client(client: EmbeddingsClient | None) -> None:
    """埋め込みクライアントを差し替える（None で既定へ戻す）。テストは Fake を注入。"""
    global _client
    _client = client


def get_embeddings_client() -> EmbeddingsClient:
    """現在の埋め込みクライアント（未設定なら config から OpenAI 互換を遅延生成）。"""
    global _client
    if _client is None:
        s = get_settings()
        _client = OpenAICompatibleEmbeddings(
            base_url=s.alignment_embed_base_url, model=s.alignment_embed_model,
            api_key=s.alignment_embed_api_key, timeout=s.alignment_embed_timeout_seconds,
        )
    return _client


def cosine(a: list[float], b: list[float]) -> float:
    """ベクトル cosine（0..1 目安・負値は 0 に丸め）。次元不一致/ゼロは 0.0。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return max(0.0, dot / (na * nb))
