"""整合率の類似度プロバイダ（keyword / embedding / hybrid・A-2・FR-44）。

`alignment.py` の差し替え点。会社設定 `alignment_method` で実装を選ぶ。
- **keyword**＝トークン頻度ベクトルの cosine（`derive.token_cosine`・決定的・外部未接続）。
- **embedding**＝保存済み埋め込み（`entity_embeddings`）の cosine（意味的一致・A-2）。埋め込みが無い/モデル不一致は
  **keyword へフォールバック**（保存時に埋め込みサーバへ到達できなかった等でも壊れない）。
- **hybrid**＝`w*keyword + (1-w)*embedding`（既定 w=0.5・config `alignment_hybrid_keyword_weight`）。会社 UI には
  式を出さない（過剰回避）＝会社が選ぶのは3方式のみ。埋め込み不可時は keyword 単独に縮退。

「効いた語（matched_tokens）」は方式に依らず **keyword 由来**（意味方式でも説明可能性を担保・ユーザー合意）。
"""
from __future__ import annotations

import uuid
from typing import Protocol

from app.core.config import get_settings
from app.infra.llm.embeddings import cosine, get_embeddings_client
from app.tenant.info import derive
from app.tenant.tokens import repository as tokens_repo

ALIGNMENT_METHODS = ("keyword", "embedding", "hybrid")


class SimilarityProvider(Protocol):
    method: str

    def score(self, ts, *, idea_id: uuid.UUID, idea_tokens, doc_id: uuid.UUID, doc_tokens) -> float: ...


def _keyword_score(idea_tokens, doc_tokens) -> float:
    return derive.token_cosine(idea_tokens, doc_tokens)


class KeywordProvider:
    method = "keyword"

    def score(self, ts, *, idea_id, idea_tokens, doc_id, doc_tokens) -> float:
        return _keyword_score(idea_tokens, doc_tokens)


class EmbeddingProvider:
    """保存済み埋め込みの cosine。欠損/モデル不一致は keyword フォールバック（graceful degradation）。"""
    method = "embedding"

    def _embedding_score(self, ts, idea_id, doc_id) -> float | None:
        model = get_embeddings_client().model
        va = tokens_repo.embedding_for(ts, "idea", idea_id, model=model)
        vb = tokens_repo.embedding_for(ts, "strategy_doc", doc_id, model=model)
        if va is None or vb is None:
            return None  # 埋め込み未生成/モデル不一致＝呼び出し側でフォールバック
        return cosine(va, vb)

    def score(self, ts, *, idea_id, idea_tokens, doc_id, doc_tokens) -> float:
        emb = self._embedding_score(ts, idea_id, doc_id)
        return emb if emb is not None else _keyword_score(idea_tokens, doc_tokens)


class HybridProvider(EmbeddingProvider):
    method = "hybrid"

    def score(self, ts, *, idea_id, idea_tokens, doc_id, doc_tokens) -> float:
        kw = _keyword_score(idea_tokens, doc_tokens)
        emb = self._embedding_score(ts, idea_id, doc_id)
        if emb is None:
            return kw  # 埋め込み不可時は keyword 単独へ縮退
        w = get_settings().alignment_hybrid_keyword_weight
        return w * kw + (1.0 - w) * emb


def provider_for(method: str | None) -> SimilarityProvider:
    """会社設定の方式名からプロバイダを解決（未知/未設定は keyword）。"""
    if method == "embedding":
        return EmbeddingProvider()
    if method == "hybrid":
        return HybridProvider()
    return KeywordProvider()
