"""W-TC-001〜015: リッチテキスト PM-JSON サニタイズ中核（`app/core/richtext.py`）の純関数単体。

セキュリティ最優先＝蓄積型 XSS を保存境界で止める。保存形式＝PM-JSON（TipTap/ProseMirror）。
`sanitize_pm`（許可リスト検証＝canonical PM へ正規化）・`pm_to_html`（決定的直列化）・
`pm_to_text`（平文抽出）を検証する。許可リスト/直列化契約は doc/テスト/W_リッチテキスト.md 冒頭を正とする。
"""
from __future__ import annotations

from app.core import richtext


def _doc(*content: dict) -> dict:
    return {"type": "doc", "content": list(content)}


def _p(*content: dict) -> dict:
    return {"type": "paragraph", "content": list(content)}


def _text(value: str, marks: list[dict] | None = None) -> dict:
    node: dict = {"type": "text", "text": value}
    if marks is not None:
        node["marks"] = marks
    return node


def test_w_tc_001_allowed_nodes_marks_serialize():
    """W-TC-001: 許可ノード/マークを保持して直列化。"""
    doc = _doc(
        {"type": "heading", "attrs": {"level": 2}, "content": [_text("見出し")]},
        _p(
            _text("太字", [{"type": "bold"}]),
            _text("斜体", [{"type": "italic"}]),
            _text("リンク", [{"type": "link", "attrs": {"href": "https://ok.example"}}]),
        ),
        {"type": "bulletList", "content": [
            {"type": "listItem", "content": [_p(_text("項目"))]},
        ]},
    )
    html = richtext.pm_to_html(doc)
    assert "<h2>見出し</h2>" in html
    assert "<strong>太字</strong>" in html
    assert "<em>斜体</em>" in html
    assert '<a href="https://ok.example" rel="noopener noreferrer nofollow">リンク</a>' in html
    assert "<ul><li><p>項目</p></li></ul>" in html


def test_w_tc_002_unknown_nodes_dropped():
    """W-TC-002: 未知ノードを除去（既知の兄弟は保持）。"""
    doc = _doc(
        {"type": "iframe", "attrs": {"src": "https://evil.example"}},
        {"type": "script", "content": [_text("alert(1)")]},
        {"type": "rawHtml", "text": "<img src=x onerror=alert(1)>"},
        _p(_text("safe")),
    )
    html = richtext.pm_to_html(doc)
    assert "<iframe" not in html and "<script" not in html
    assert "onerror" not in html and "<img" not in html
    assert "<p>safe</p>" in html  # 既知の兄弟は残る
    cleaned = richtext.sanitize_pm(doc)
    kinds = {n.get("type") for n in cleaned.get("content", [])}
    assert kinds == {"paragraph"}


def test_w_tc_003_unknown_marks_dropped_text_kept():
    """W-TC-003: 未知マークを除去（text は保持）。"""
    doc = _doc(_p(_text("x", [{"type": "blink"}, {"type": "onclick"}])))
    html = richtext.pm_to_html(doc)
    assert "blink" not in html and "onclick" not in html
    assert "<p>x</p>" in html


def test_w_tc_004_link_href_scheme_validation():
    """W-TC-004: リンク href のスキーム検証（javascript:/data:/vbscript: 除去）。"""
    for bad in ("javascript:alert(1)", "data:text/html,<script>", "vbscript:msgbox(1)"):
        doc = _doc(_p(_text("t", [{"type": "link", "attrs": {"href": bad}}])))
        html = richtext.pm_to_html(doc)
        assert "javascript:" not in html and "data:" not in html and "vbscript:" not in html
        assert "<a " not in html  # リンクマークごと除去
        assert "t" in html  # text は残る
    for ok in ("https://ok.example", "http://ok.example", "/relative/path", "mailto:a@b.example"):
        doc = _doc(_p(_text("t", [{"type": "link", "attrs": {"href": ok}}])))
        html = richtext.pm_to_html(doc)
        assert f'href="{ok}"' in html


def test_w_tc_005_image_src_scheme_and_alt_escape():
    """W-TC-005: 画像 src スキーム検証＋alt エスケープ。"""
    for bad in ("javascript:alert(1)", "data:image/png;base64,AAAA"):
        doc = _doc({"type": "image", "attrs": {"src": bad, "alt": "x"}})
        html = richtext.pm_to_html(doc)
        assert "<img" not in html  # 不正 src は丸ごと落とす
    doc = _doc({"type": "image", "attrs": {"src": "/files/x.png", "alt": '"><script>'}})
    html = richtext.pm_to_html(doc)
    assert '<img src="/files/x.png"' in html
    assert "<script>" not in html and "&lt;script&gt;" in html  # alt エスケープ


def test_w_tc_006_mention_node_id_validation():
    """W-TC-006: mention ノードの id 形式検証。"""
    ok = _doc(_p({"type": "mention", "attrs": {"id": "acc_123", "label": "山田"}}))
    html = richtext.pm_to_html(ok)
    assert '<span data-type="mention" data-id="acc_123">@山田</span>' in html
    bad = _doc(_p({"type": "mention", "attrs": {"id": "<x>", "label": "太郎"}}))
    html2 = richtext.pm_to_html(bad)
    assert "data-id" not in html2  # 不正 id は属性に通さない
    assert "@太郎" in html2


def test_w_tc_007_heading_level_clamped():
    """W-TC-007: heading.level を 1–3 にクランプ。"""
    assert "<h3>" in richtext.pm_to_html(_doc({"type": "heading", "attrs": {"level": 7}, "content": [_text("a")]}))
    assert "<h1>" in richtext.pm_to_html(_doc({"type": "heading", "attrs": {"level": 0}, "content": [_text("b")]}))
    assert "<h1>" in richtext.pm_to_html(_doc({"type": "heading", "attrs": {"level": "x"}, "content": [_text("c")]}))
    assert "<h7" not in richtext.pm_to_html(_doc({"type": "heading", "attrs": {"level": 7}, "content": [_text("a")]}))


def test_w_tc_008_text_escaped():
    """W-TC-008: テキストの HTML エスケープ（生タグ注入不可）。"""
    doc = _doc(_p(_text("<script>alert(1)</script> & <b>x</b>")))
    html = richtext.pm_to_html(doc)
    assert "<script" not in html and "<b>" not in html
    assert "&lt;script&gt;" in html and "&amp;" in html and "&lt;b&gt;" in html


def test_w_tc_009_serialization_deterministic():
    """W-TC-009: 直列化の決定性（マーク順固定・バイト一致）。"""
    marks_a = [{"type": "bold"}, {"type": "italic"}, {"type": "link", "attrs": {"href": "https://ok.example"}}]
    marks_b = [{"type": "link", "attrs": {"href": "https://ok.example"}}, {"type": "italic"}, {"type": "bold"}]
    html_a = richtext.pm_to_html(_doc(_p(_text("x", marks_a))))
    html_b = richtext.pm_to_html(_doc(_p(_text("x", marks_b))))
    assert html_a == html_b  # マーク順に依らず一致
    assert '<a href="https://ok.example" rel="noopener noreferrer nofollow"><strong><em>x</em></strong></a>' in html_a
    assert richtext.pm_to_html(_doc(_p(_text("x", marks_a)))) == html_a  # 再現性


def test_w_tc_010_codeblock():
    """W-TC-010: codeBlock（language 検証・内部エスケープ）。"""
    doc = _doc({"type": "codeBlock", "attrs": {"language": "python"}, "content": [_text("print('<x>')")]})
    html = richtext.pm_to_html(doc)
    assert '<pre><code class="language-python">' in html
    assert "&lt;x&gt;" in html and "<x>" not in html
    bad = _doc({"type": "codeBlock", "attrs": {"language": "js; <x>"}, "content": [_text("a")]})
    html2 = richtext.pm_to_html(bad)
    assert "class=" not in html2 and "<pre><code>" in html2


def test_w_tc_011_table_dangerous_attrs_removed():
    """W-TC-011: table の危険属性除去（style/巨大colspan）。"""
    doc = _doc({"type": "table", "content": [
        {"type": "tableRow", "content": [
            {"type": "tableHeader", "attrs": {"style": "x", "colspan": 2}, "content": [_p(_text("H"))]},
            {"type": "tableCell", "attrs": {"colspan": 99999}, "content": [_p(_text("C"))]},
        ]},
    ]})
    html = richtext.pm_to_html(doc)
    assert "<table><tbody><tr>" in html and "<th" in html and "<td" in html
    assert "style" not in html
    assert 'colspan="2"' in html  # 正常 colspan は許可
    assert "99999" not in html   # 範囲外 colspan は除去


def test_w_tc_012_pm_to_text():
    """W-TC-012: 平文抽出（body_text 用）。"""
    doc = _doc(
        {"type": "heading", "attrs": {"level": 2}, "content": [_text("見出し")]},
        _p(_text("本文テキスト")),
        {"type": "bulletList", "content": [
            {"type": "listItem", "content": [_p(_text("項目"))]},
        ]},
    )
    text = richtext.pm_to_text(doc)
    assert "見出し" in text and "本文テキスト" in text and "項目" in text
    assert "<" not in text and "  " not in text  # タグ無し・空白正規化


def test_w_tc_013_robust_fallback():
    """W-TC-013: 入力頑健性（安全側フォールバック）。"""
    for bad in (None, {}, "not json {", {"content": [_text("x")]}, 123, []):
        assert isinstance(richtext.sanitize_pm(bad), dict)
        assert isinstance(richtext.pm_to_html(bad), str)
        assert isinstance(richtext.pm_to_text(bad), str)


def test_w_tc_014_link_rel_attrs():
    """W-TC-014: リンクに rel（tabnabbing/referrer 防止）。"""
    doc = _doc(_p(_text("x", [{"type": "link", "attrs": {"href": "https://ext.example"}}])))
    html = richtext.pm_to_html(doc)
    assert 'rel="noopener noreferrer nofollow"' in html


def test_w_tc_015_sanitize_pm_idempotent_canonical():
    """W-TC-015: sanitize_pm は冪等な canonical PM。"""
    doc = _doc(
        {"type": "iframe"},
        _p(_text("y", [{"type": "blink"}, {"type": "bold"}])),
    )
    once = richtext.sanitize_pm(doc)
    twice = richtext.sanitize_pm(once)
    assert once == twice  # 冪等（canonical）
    assert richtext.pm_to_html(richtext.sanitize_pm(doc)) == richtext.pm_to_html(doc)
