"""リッチテキストの無害化・平文化（中立モジュール・DRY＝コーディング規約 §2.3）。

情報インプット（N.7）の `sanitize_html`/`to_plain_text` を info 非依存に抽出し、
お知らせ（FR-49・U）など他ドメインからも共用する。許可リスト方式で XSS を保存時に無害化
（nh3・Rust製）。on* 属性・script・`javascript:` を全弾き。外部送信ゼロ・オフライン。
"""
from __future__ import annotations

import re

# 許可タグ（p/br/見出し/強調/リスト/リンク/引用/コード/表/画像）。属性は最小限（a=href/title, img=src/alt）。
ALLOWED_TAGS = {
    "p", "br", "h1", "h2", "h3", "strong", "em", "u", "s", "ul", "ol", "li",
    "a", "blockquote", "code", "pre", "table", "thead", "tbody", "tr", "th", "td", "img",
}
ALLOWED_ATTRS = {"a": {"href", "title"}, "img": {"src", "alt"}}
# URL スキームは http/https のみ許可（javascript: 等は除去）。
URL_SCHEMES = {"http", "https"}


def sanitize_html(html: str | None) -> str:
    """リッチ本文を許可リストで無害化（保存時）。nh3 未導入時も安全側でタグ除去にフォールバック。"""
    if not html:
        return ""
    try:
        import nh3
        return nh3.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, url_schemes=URL_SCHEMES)
    except Exception:
        return strip_tags(html)  # 保険＝タグ全除去（安全側）


def to_plain_text(html: str | None) -> str:
    """サニタイズ済 HTML → 平文（検索/要約の元）。タグ除去＋空白正規化。"""
    if not html:
        return ""
    return re.sub(r"\s+", " ", strip_tags(html)).strip()


def strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)
