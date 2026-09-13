"""FR-39 (c) チャットの自動要約（抽出型・オフライン・無料）＝将来 LLM 生成要約へ差し替える seam。

外部API・課金・外部送信なし。janome（純Python・データDL不要）で内容語を抽出し、頻度ベースで
重要文を選ぶ古典的な extractive 要約。決定的（同入力→同出力）。品質は生成型より粗い前提。

差し替え方針：本モジュールの `summarize_text` だけを LLM 呼び出しに置換すれば (c) を高品質化できる
（application/router/DB/フロントは無改修）。
"""
from __future__ import annotations

import re

# 内容語として扱う品詞（名詞・動詞・形容詞）。助詞/助動詞/記号などは重みに数えない。
_CONTENT_POS = ("名詞", "動詞", "形容詞")
# 文分割＝日本語の句点/改行/記号。抽出型は「原文の文」を選ぶため生成はしない。
_SENT_SPLIT = re.compile(r"(?<=[。．！？!?\n])")


def _sentences(text: str) -> list[str]:
    parts = [s.strip() for s in _SENT_SPLIT.split(text or "")]
    return [s for s in parts if s]


def summarize_text(text: str, *, max_sentences: int = 5) -> str:
    """抽出型要約＝内容語の頻度で各文をスコアし、上位を原文の並び順で返す（オフライン・無料）。

    - 文が max_sentences 以下ならそのまま結合して返す（要約不要）。
    - janome 未導入など失敗時は先頭数文にフォールバック（機能を落とさない）。
    """
    sents = _sentences(text)
    if len(sents) <= max_sentences:
        return "".join(sents)
    try:
        from janome.tokenizer import Tokenizer

        tok = Tokenizer()
        # 各文の内容語（基本形）を抽出。
        per_sent_terms: list[list[str]] = []
        freq: dict[str, int] = {}
        for s in sents:
            terms = []
            for t in tok.tokenize(s):
                pos = t.part_of_speech.split(",")[0]
                if pos in _CONTENT_POS:
                    base = t.base_form if t.base_form and t.base_form != "*" else t.surface
                    if len(base) >= 2:  # 1文字語はノイズになりやすい
                        terms.append(base)
                        freq[base] = freq.get(base, 0) + 1
            per_sent_terms.append(terms)
        # 文スコア＝内容語頻度の和 / 文長で正規化（長文偏重を避ける）。
        scored = []
        for i, terms in enumerate(per_sent_terms):
            score = sum(freq[t] for t in terms) / (len(terms) + 1)
            scored.append((score, i))
        top_idx = sorted(i for _s, i in sorted(scored, reverse=True)[:max_sentences])
        return "".join(sents[i] for i in top_idx)
    except Exception:
        return "".join(sents[:max_sentences])
