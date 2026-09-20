"""情報インプットの保存時派生（N.6/N.7・§12）＝サニタイズ→平文→トークン→要約の純関数群。

- `sanitize_html`＝リッチ本文を**許可リスト方式で無害化**（nh3・Rust製）。on* 属性・script・`javascript:` を全弾き。
- `to_plain_text`＝サニタイズ済 HTML からタグを除いた平文（body_text＝検索/トークン/要約の元）。
- `extract_tokens`＝janome で内容語（名詞/動詞/形容詞）を抽出し頻度集計（ワードクラウド/類似度・§5.36）。
- `is_valid_source_url`＝出典URL は http/https のみ（N.7）。
外部送信ゼロ・オフライン（janome/nh3 とも純ローカル）。要約は `quests/summarize.py` の `summarize_text` を再利用。
"""
from __future__ import annotations

import re

# 許可タグ（§N.7＝p/br/見出し/強調/リスト/リンク/引用/コード/表/画像）。属性は最小限（a=href, img=src/alt）。
_ALLOWED_TAGS = {
    "p", "br", "h1", "h2", "h3", "strong", "em", "u", "s", "ul", "ol", "li",
    "a", "blockquote", "code", "pre", "table", "thead", "tbody", "tr", "th", "td", "img",
}
_ALLOWED_ATTRS = {"a": {"href", "title"}, "img": {"src", "alt"}}
# URL スキームは http/https のみ許可（javascript: 等は除去）。
_URL_SCHEMES = {"http", "https"}

# トークン抽出の内容語 POS とストップワード（頻出の機能語・ノイズを除外）。
_CONTENT_POS = ("名詞", "動詞", "形容詞")
_STOPWORDS = {
    "する", "ある", "いる", "なる", "れる", "られる", "こと", "もの", "ため", "よう", "これ", "それ",
    "の", "ん", "さん", "很", "できる", "行う", "思う", "いう", "みる", "くる", "その", "この",
}


def sanitize_html(html: str | None) -> str:
    """リッチ本文を許可リストで無害化（保存時・§N.7）。nh3 未導入時も安全側でタグ除去にフォールバック。"""
    if not html:
        return ""
    try:
        import nh3
        return nh3.clean(html, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, url_schemes=_URL_SCHEMES)
    except Exception:
        return _strip_tags(html)  # 保険＝タグ全除去（安全側）


def to_plain_text(html: str | None) -> str:
    """サニタイズ済 HTML → 平文（body_text）。タグ除去＋空白正規化。"""
    if not html:
        return ""
    return re.sub(r"\s+", " ", _strip_tags(html)).strip()


def _strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)


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
