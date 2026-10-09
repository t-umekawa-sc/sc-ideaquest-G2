"""リッチテキストの無害化・平文化（中立モジュール・DRY＝コーディング規約 §2.3）。

情報インプット（N.7）の `sanitize_html`/`to_plain_text` を info 非依存に抽出し、
お知らせ（FR-49・U）など他ドメインからも共用する。許可リスト方式で XSS を保存時に無害化
（nh3・Rust製）。on* 属性・script・`javascript:` を全弾き。外部送信ゼロ・オフライン。
"""
from __future__ import annotations

import json
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


# ===========================================================================
# PM-JSON（TipTap/ProseMirror）サニタイズ中核（リッチテキスト統一・W-TC-001〜015）
# ---------------------------------------------------------------------------
# セキュリティ最優先＝蓄積型 XSS を保存境界で止める。保存形式＝PM-JSON。
# 「任意 HTML を nh3 で削る」から「PM-JSON を許可リスト（ノード/マーク/属性）で検証し、
# 決定的に直列化する」へ転換（モデル→既知タグが1対1＝許可リストが精密に書ける）。
# 契約の正本＝doc/テスト/W_リッチテキスト.md 冒頭。純関数（外部送信ゼロ・オフライン）。
# ===========================================================================

# 許可マーク → 出力タグ。入れ子は固定順（link>bold>italic>strike>code）＝直列化の決定性。
_MARK_ORDER = {"link": 0, "bold": 1, "italic": 2, "strike": 3, "code": 4}
_MARK_TAG = {"bold": "strong", "italic": "em", "strike": "s", "code": "code"}
# URL スキーム＝http/https/mailto/相対（単一スラッシュ・`//` protocol-relative は不可）のみ。
# `javascript:`/`data:`/`vbscript:` 等は不一致＝除去。
_LINK_OK = re.compile(r"^(https?://|mailto:|/(?!/))", re.I)
_IMG_OK = re.compile(r"^(https?://|/(?!/))", re.I)  # 画像は http/https/相対のみ（mailto 不可・data: 除去）
_MENTION_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")  # メンション id の許容形式
_LANG = re.compile(r"^[A-Za-z0-9+#-]+$")            # codeBlock language の許容形式


def sanitize_pm(raw: object) -> dict:
    """PM-JSON を許可リストで検証し canonical な `doc` へ正規化（保存境界）。

    未知ノード/マーク/属性は除去。冪等（`sanitize_pm(sanitize_pm(x)) == sanitize_pm(x)`）。
    入力は dict／JSON文字列／不正値いずれも受け、安全側で空 `doc` を返す（保存を止めない）。
    """
    doc = _parse(raw)
    content = doc.get("content") if isinstance(doc, dict) else None
    blocks = []
    if isinstance(content, list):
        for node in content:
            cleaned = _clean(node)
            if cleaned is not None:
                blocks.append(cleaned)
    return {"type": "doc", "content": blocks}


def pm_to_html(raw: object) -> str:
    """サニタイズ済 PM-JSON を許可リストで決定的に直列化した HTML（表示/`body_html` 用）。

    入力が未サニタイズでも内部で `sanitize_pm` を通すため、単体で XSS 安全（多層防御）。
    """
    return _ser_nodes(sanitize_pm(raw).get("content", []))


def pm_to_text(raw: object) -> str:
    """PM-JSON → 平文（検索/トークン/要約の元＝body_text）。テキストのみ連結・空白正規化。"""
    parts: list[str] = []
    _collect_text(sanitize_pm(raw), parts)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


# --- 内部（検証） ---------------------------------------------------------

def _parse(raw: object) -> dict:
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except Exception:
            return {}
        return value if isinstance(value, dict) else {}
    return raw if isinstance(raw, dict) else {}


def _clean_list(content: object, only: set[str] | None = None) -> list[dict]:
    out: list[dict] = []
    if isinstance(content, list):
        for node in content:
            cleaned = _clean(node)
            if cleaned is None:
                continue
            if only is not None and cleaned.get("type") not in only:
                continue
            out.append(cleaned)
    return out


def _clean_marks(marks: object) -> list[dict]:
    """許可マークのみ（type で重複排除）→ 固定順にソートした canonical マーク配列。"""
    picked: dict[str, dict] = {}
    if isinstance(marks, list):
        for mark in marks:
            if not isinstance(mark, dict):
                continue
            t = mark.get("type")
            if t not in _MARK_ORDER:
                continue
            if t == "link":
                href = _valid_url((mark.get("attrs") or {}).get("href"), _LINK_OK)
                if not href:
                    continue
                picked[t] = {"type": "link", "attrs": {"href": href}}
            else:
                picked[t] = {"type": t}
    return [picked[t] for t in sorted(picked, key=lambda x: _MARK_ORDER[x])]


def _clamp_level(value: object) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 1
    return 1 if n < 1 else 3 if n > 3 else n


def _valid_url(url: object, pattern: re.Pattern[str]) -> str | None:
    if not isinstance(url, str):
        return None
    u = url.strip()
    if not u or any(ord(c) < 0x20 for c in u):  # 制御文字混入（`java\tscript:` 等）は拒否
        return None
    return u if pattern.match(u) else None


def _clean_cell_attrs(attrs: object) -> dict:
    out: dict = {}
    a = attrs if isinstance(attrs, dict) else {}
    for key in ("colspan", "rowspan"):
        v = a.get(key)
        if isinstance(v, bool):
            continue
        if isinstance(v, int) and 1 <= v <= 1000:
            out[key] = v
    return out


def _clean(node: object) -> dict | None:
    """1ノードを許可リストで検証し canonical ノードを返す（未知は None＝除去）。"""
    if not isinstance(node, dict):
        return None
    t = node.get("type")
    if t == "text":
        s = node.get("text")
        if not isinstance(s, str) or s == "":
            return None
        marks = _clean_marks(node.get("marks"))
        out: dict = {"type": "text", "text": s}
        if marks:
            out["marks"] = marks
        return out
    if t == "hardBreak":
        return {"type": "hardBreak"}
    if t == "horizontalRule":
        return {"type": "horizontalRule"}
    if t == "paragraph":
        return {"type": "paragraph", "content": _clean_list(node.get("content"))}
    if t == "heading":
        level = _clamp_level((node.get("attrs") or {}).get("level"))
        return {"type": "heading", "attrs": {"level": level}, "content": _clean_list(node.get("content"))}
    if t == "blockquote":
        return {"type": "blockquote", "content": _clean_list(node.get("content"))}
    if t in ("bulletList", "orderedList"):
        return {"type": t, "content": _clean_list(node.get("content"), only={"listItem"})}
    if t == "listItem":
        return {"type": "listItem", "content": _clean_list(node.get("content"))}
    if t == "codeBlock":
        lang = (node.get("attrs") or {}).get("language")
        texts = [
            {"type": "text", "text": ch["text"]}
            for ch in (node.get("content") or [])
            if isinstance(ch, dict) and ch.get("type") == "text" and isinstance(ch.get("text"), str)
        ]
        out = {"type": "codeBlock", "content": texts}
        if isinstance(lang, str) and _LANG.match(lang):
            out["attrs"] = {"language": lang}
        return out
    if t == "image":
        src = _valid_url((node.get("attrs") or {}).get("src"), _IMG_OK)
        if not src:
            return None  # 不正 src の image は丸ごと除去
        alt = (node.get("attrs") or {}).get("alt")
        return {"type": "image", "attrs": {"src": src, "alt": alt if isinstance(alt, str) else ""}}
    if t == "mention":
        a = node.get("attrs") or {}
        label = a.get("label")
        label = label if isinstance(label, str) else ""
        mid = a.get("id")
        if isinstance(mid, str) and _MENTION_ID.match(mid):
            return {"type": "mention", "attrs": {"id": mid, "label": label}}
        return {"type": "mention", "attrs": {"label": label}}  # 不正 id は属性に通さない
    if t == "table":
        return {"type": "table", "content": _clean_list(node.get("content"), only={"tableRow"})}
    if t == "tableRow":
        return {"type": "tableRow", "content": _clean_list(node.get("content"), only={"tableHeader", "tableCell"})}
    if t in ("tableHeader", "tableCell"):
        out = {"type": t, "content": _clean_list(node.get("content"))}
        attrs = _clean_cell_attrs(node.get("attrs"))
        if attrs:
            out["attrs"] = attrs
        return out
    return None  # 未知ノードは除去


# --- 内部（直列化） -------------------------------------------------------

def _esc_text(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _esc_attr(s: str) -> str:
    return _esc_text(s).replace('"', "&quot;")


def _ser_nodes(nodes: list[dict]) -> str:
    return "".join(_ser(n) for n in nodes)


def _ser_text(node: dict) -> str:
    html = _esc_text(node.get("text", ""))
    for mark in reversed(node.get("marks", [])):  # 内側(code)→外側(link) の順で包む
        t = mark["type"]
        if t == "link":
            href = _esc_attr(mark["attrs"]["href"])
            html = f'<a href="{href}" rel="noopener noreferrer nofollow">{html}</a>'
        else:
            tag = _MARK_TAG[t]
            html = f"<{tag}>{html}</{tag}>"
    return html


def _ser(node: dict) -> str:
    t = node.get("type")
    if t == "text":
        return _ser_text(node)
    if t == "hardBreak":
        return "<br>"
    if t == "horizontalRule":
        return "<hr>"
    if t == "paragraph":
        return f"<p>{_ser_nodes(node['content'])}</p>"
    if t == "heading":
        lvl = node["attrs"]["level"]
        return f"<h{lvl}>{_ser_nodes(node['content'])}</h{lvl}>"
    if t == "blockquote":
        return f"<blockquote>{_ser_nodes(node['content'])}</blockquote>"
    if t == "bulletList":
        return f"<ul>{_ser_nodes(node['content'])}</ul>"
    if t == "orderedList":
        return f"<ol>{_ser_nodes(node['content'])}</ol>"
    if t == "listItem":
        return f"<li>{_ser_nodes(node['content'])}</li>"
    if t == "codeBlock":
        lang = (node.get("attrs") or {}).get("language")
        cls = f' class="language-{lang}"' if lang else ""
        body = _esc_text("".join(ch.get("text", "") for ch in node.get("content", [])))
        return f"<pre><code{cls}>{body}</code></pre>"
    if t == "image":
        return f'<img src="{_esc_attr(node["attrs"]["src"])}" alt="{_esc_attr(node["attrs"]["alt"])}">'
    if t == "mention":
        attrs = node.get("attrs") or {}
        data_id = f' data-id="{_esc_attr(attrs["id"])}"' if attrs.get("id") else ""
        return f'<span data-type="mention"{data_id}>@{_esc_text(attrs.get("label", ""))}</span>'
    if t == "table":
        return f"<table><tbody>{_ser_nodes(node['content'])}</tbody></table>"
    if t == "tableRow":
        return f"<tr>{_ser_nodes(node['content'])}</tr>"
    if t in ("tableHeader", "tableCell"):
        tag = "th" if t == "tableHeader" else "td"
        attrs = node.get("attrs") or {}
        extra = "".join(f' {k}="{attrs[k]}"' for k in ("colspan", "rowspan") if k in attrs)
        return f"<{tag}{extra}>{_ser_nodes(node['content'])}</{tag}>"
    return ""  # clean 済みのため到達しない（多層防御）


def _collect_text(node: dict, parts: list[str]) -> None:
    t = node.get("type")
    if t == "text":
        parts.append(node.get("text", ""))
        return
    if t == "mention":
        parts.append("@" + (node.get("attrs") or {}).get("label", ""))
        return
    for child in node.get("content", []) or []:
        if isinstance(child, dict):
            _collect_text(child, parts)
