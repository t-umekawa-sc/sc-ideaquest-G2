#!/usr/bin/env python3
"""doc/機能ガイド/ideaquest_機能ガイド.md → 参照PDF風の体裁で HTML を生成する（→ chromium で PDF 化）。

md を単一の正とし、決まった構造（# ブランド / ## 画面で見る… / ## ― NN 見出し / ✓箇条書き /
**ISO 56001 対応**：… / # 将来… / 箇条書き / footer-note）を HTML へ変換する専用パーサ。
"""
import html
import re
import sys
from pathlib import Path

SRC = Path(__file__).with_name("ideaquest_機能ガイド.md")
OUT = Path(__file__).with_name("ideaquest_機能ガイド.html")


def inline(text: str) -> str:
    """**bold** と ISO 箇条番号を軽くマークアップ（エスケープ後）。"""
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    return text


def main() -> None:
    lines = SRC.read_text(encoding="utf-8").splitlines()
    # frontmatter を除去
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), 0)
        lines = lines[end + 1:]

    body: list[str] = []
    i = 0
    n = len(lines)
    in_check = False  # ✓ 箇条書き中
    in_future = False  # 将来機能セクション中

    def close_check():
        nonlocal in_check
        if in_check:
            body.append("</ul>")
            in_check = False

    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # ブランド（最初の H1）
        if stripped == "# ideaquest":
            close_check()
            body.append('<div class="brand">ideaquest</div>')
            i += 1
            continue

        # カバータイトル（## 画面で見る…）
        if stripped.startswith("## ") and "画面で見る機能ガイド" in stripped:
            close_check()
            title = stripped[3:].strip()
            body.append(f'<h1 class="cover-title">{inline(title)}</h1>')
            i += 1
            continue

        # 将来機能セクション（# 将来…）
        if stripped.startswith("# 将来"):
            close_check()
            in_future = True
            body.append('<div class="future">')
            body.append(f'<h2 class="future-title">{inline(stripped[2:].strip())}</h2>')
            i += 1
            continue

        # 機能セクション（## ― NN　見出し）
        m = re.match(r"^##\s*―\s*(\d+)[　\s]+(.+)$", stripped)
        if m:
            close_check()
            num, heading = m.group(1), m.group(2)
            body.append('<section class="feature">')
            body.append(f'<div class="feat-num">— {num}</div>')
            body.append(f'<h2 class="feat-title">{inline(heading)}</h2>')
            i += 1
            continue

        # ノート（> …）＝連続行をまとめる
        if stripped.startswith(">"):
            close_check()
            note: list[str] = []
            while i < n and lines[i].strip().startswith(">"):
                note.append(lines[i].strip().lstrip(">").strip())
                i += 1
            body.append(f'<div class="note">{inline(" ".join(note))}</div>')
            continue

        # ISO タグ
        if stripped.startswith("**ISO 56001 対応**"):
            close_check()
            val = stripped.split("：", 1)[1] if "：" in stripped else stripped
            body.append(f'<div class="iso"><span class="iso-label">ISO 56001</span>'
                        f'<span class="iso-val">{inline(val)}</span></div>')
            i += 1
            continue

        # ✓ 箇条書き
        if stripped.startswith("- ✓"):
            if not in_check:
                body.append('<ul class="checklist">')
                in_check = True
            body.append(f'<li>{inline(stripped[3:].strip())}</li>')
            i += 1
            continue

        # 将来機能の箇条書き（- **name** ― …）と サブ（  - ➟ …）
        if in_future and re.match(r"^-\s+\*\*", stripped):
            close_check()
            body.append(f'<div class="future-item">{inline(stripped[1:].strip())}</div>')
            i += 1
            continue
        if in_future and stripped.startswith("- ➟"):
            close_check()
            body.append(f'<div class="future-iso">{inline(stripped[1:].strip())}</div>')
            i += 1
            continue

        # フッター
        if stripped.startswith('<div class="footer-note"'):
            close_check()
            txt = re.sub(r"<[^>]+>", "", stripped)
            body.append(f'<div class="footer-note">{html.escape(txt)}</div>')
            i += 1
            continue

        # 区切り線 --- は無視（セクションで表現）
        if stripped == "---":
            close_check()
            i += 1
            continue

        # それ以外＝説明段落（連続する平文行は1段落に結合＝1文の途中改行で段落が割れないように）
        close_check()
        para = [stripped]
        i += 1
        while i < n:
            nxt = lines[i].strip()
            if not nxt:
                break
            if (nxt.startswith("#") or nxt.startswith(">") or nxt.startswith("- ")
                    or nxt.startswith("**ISO") or nxt == "---" or nxt.startswith("<div")):
                break
            para.append(nxt)
            i += 1
        body.append(f'<p class="desc">{inline("".join(para))}</p>')

    close_check()
    if in_future:
        body.append("</div>")  # .future

    css = """
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Noto Sans CJK JP', sans-serif; color: #1f2937; line-height: 1.75;
           font-size: 10.5pt; margin: 0; }
    .brand { color: #0f766e; font-weight: 700; font-size: 9pt; letter-spacing: .18em; margin-bottom: 6px; }
    .cover-title { font-family: 'Noto Serif CJK JP', serif; font-size: 25pt; font-weight: 700;
                   color: #111827; margin: 0 0 10px; line-height: 1.3; }
    .note { font-size: 9pt; color: #4b5563; background: #f1f7f6; border-left: 3px solid #0f766e;
            padding: 10px 14px; border-radius: 4px; margin: 14px 0 4px; }
    .feature { border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 18px; }
    .feature ul.checklist, .feature .iso { break-inside: avoid; }
    .feat-num { font-family: 'Noto Sans Mono CJK JP', monospace; color: #0f766e; font-weight: 700;
                font-size: 9pt; letter-spacing: .1em; margin-bottom: 6px; }
    .feat-title { font-family: 'Noto Serif CJK JP', serif; font-size: 16pt; font-weight: 700;
                  color: #111827; margin: 0 0 8px; line-height: 1.35; }
    .desc { color: #374151; margin: 0 0 10px; }
    ul.checklist { list-style: none; padding: 0; margin: 0 0 12px; }
    ul.checklist li { position: relative; padding-left: 22px; margin: 5px 0; color: #1f2937; }
    ul.checklist li::before { content: "✓"; position: absolute; left: 0; top: 0; color: #16a34a;
                              font-weight: 700; }
    .iso { display: flex; align-items: baseline; gap: 10px; background: #f1f7f6; border: 1px solid #cfe6e2;
           border-radius: 6px; padding: 8px 12px; margin-top: 6px; }
    .iso-label { flex: 0 0 auto; background: #0f766e; color: #fff; font-weight: 700; font-size: 8pt;
                 letter-spacing: .08em; padding: 2px 8px; border-radius: 999px; }
    .iso-val { font-size: 9.5pt; color: #0f4f49; }
    .future { border-top: 3px solid #0f766e; margin-top: 34px; padding-top: 20px; page-break-inside: avoid; }
    .future-title { font-family: 'Noto Serif CJK JP', serif; font-size: 17pt; color: #111827;
                    margin: 0 0 10px; }
    .future-item { margin: 12px 0 2px; color: #1f2937; }
    .future-iso { color: #0f766e; font-size: 9.5pt; margin: 0 0 8px 16px; }
    .footer-note { margin-top: 40px; padding-top: 10px; border-top: 1px solid #e5e7eb;
                   color: #9ca3af; font-size: 8.5pt; text-align: center; }
    strong { font-weight: 700; }
    """

    doc = ("<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
           f"<style>{css}</style></head><body>" + "\n".join(body) + "</body></html>")
    OUT.write_text(doc, encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
