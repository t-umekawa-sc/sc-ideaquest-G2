"""情報インプットの保存時派生（N.6/N.7・§12）＝サニタイズ→平文→トークン→要約の純関数群。

- `sanitize_html`＝リッチ本文を**許可リスト方式で無害化**（nh3・Rust製）。on* 属性・script・`javascript:` を全弾き。
- `to_plain_text`＝サニタイズ済 HTML からタグを除いた平文（body_text＝検索/トークン/要約の元）。
- `extract_tokens`＝janome で内容語（名詞/動詞/形容詞）を抽出し頻度集計（ワードクラウド/類似度・§5.36）。
- `is_valid_source_url`＝出典URL は http/https のみ（N.7）。
外部送信ゼロ・オフライン（janome/nh3 とも純ローカル）。要約は `quests/summarize.py` の `summarize_text` を再利用。
"""
from __future__ import annotations

import re

# リッチ本文の無害化/平文化は中立モジュール（お知らせ U と共用・DRY §2.3）へ移設。info は再エクスポートで後方互換。
# PM-JSON（TipTap）系＝`sanitize_pm`（許可リスト検証→canonical）/`pm_to_html`（表示用直列化）/`pm_to_text`（平文）。
from app.core.richtext import (  # noqa: F401
    pm_to_html, pm_to_text, sanitize_html, sanitize_pm, strip_tags as _strip_tags, to_plain_text,
)

# トークン抽出の内容語 POS とストップワード（頻出の機能語・ノイズを除外）。
_CONTENT_POS = ("名詞", "動詞", "形容詞")
_STOPWORDS = {
    "する", "ある", "いる", "なる", "れる", "られる", "こと", "もの", "ため", "よう", "これ", "それ",
    "の", "ん", "さん", "很", "できる", "行う", "思う", "いう", "みる", "くる", "その", "この",
}


def extract_tokens(text: str | None, *, limit: int = 50) -> list[tuple[str, int]]:
    """平文から内容語トークンを抽出し頻度集計（janome・§5.36）。`[(token, count), …]`（count 降順）。"""
    if not text:
        return []
    try:
        from janome.tokenizer import Tokenizer
        tok = _get_tokenizer(Tokenizer)
        counts: dict[str, int] = {}
        for t in tok.tokenize(text):
            pos = t.part_of_speech.split(",")[0]
            if pos not in _CONTENT_POS:
                continue
            base = t.base_form if t.base_form and t.base_form != "*" else t.surface
            base = base.strip().lower()
            if len(base) < 2 or base in _STOPWORDS:
                continue
            counts[base] = counts.get(base, 0) + 1
        return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    except Exception:
        return []


def token_cosine(a: list[tuple[str, int]], b: list[tuple[str, int]]) -> float:
    """2つのトークン頻度ベクトルのコサイン類似度（自動関連付けの一致度・N.6）。

    入力＝`extract_tokens` 形式 `[(token, count), …]`。共通語が多いほど 1 に近づく。
    重なりゼロ=0.0／同一集合≈1.0。対称・順序非依存・外部送信なし（純ローカル・決定的）。
    """
    if not a or not b:
        return 0.0
    va = {t: float(c) for t, c in a}
    vb = {t: float(c) for t, c in b}
    common = va.keys() & vb.keys()
    if not common:
        return 0.0
    dot = sum(va[t] * vb[t] for t in common)
    import math
    na = math.sqrt(sum(v * v for v in va.values()))
    nb = math.sqrt(sum(v * v for v in vb.values()))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


_TOKENIZER = None


def _get_tokenizer(cls):
    """Tokenizer は初期化が重いのでプロセス内で1回だけ生成（遅延）。"""
    global _TOKENIZER
    if _TOKENIZER is None:
        _TOKENIZER = cls()
    return _TOKENIZER


def is_valid_source_url(url: str | None) -> bool:
    """出典URL は http/https のみ許可（N.7）。空は許可（任意項目）。"""
    if not url:
        return True
    return bool(re.match(r"^https?://", url.strip(), re.IGNORECASE))
