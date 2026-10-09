"""純 Python の fallback レンダラ（Jasper 不在でも PDF が落ちる＝疎結合の主要件担保・設計 §12）。

外部依存を増やさず（reportlab 等を入れず）、標準ライブラリだけで**有効な最小 PDF**（1ページ・Helvetica・
テキスト行）を生成する。高品質レイアウトは Jasper（`jasper`）が担う＝fallback はあくまで保険。
Helvetica の WinAnsi では日本語が出せないため、非 ASCII 文字は `?` に落とす（保険用途として許容・本線は Jasper）。
"""
from __future__ import annotations


def _esc(text: str) -> str:
    """PDF リテラル文字列のエスケープ＋非 Latin-1 文字の安全化（保険用途）。"""
    out = text.encode("latin-1", "replace").decode("latin-1")
    return out.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _invoice_lines(data: dict) -> list[str]:
    """請求書 payload（domain/invoice.py）を読める text 行に平坦化する。"""
    lines = [
        "USAGE INVOICE",
        "",
        f"Company : {data.get('company_name', '')} ({data.get('company_code', '')})",
        f"Period  : {data.get('period', '')}",
        f"Issued  : {data.get('issued_at', '')}",
        "",
        "Item                                 Qty      Amount",
        "--------------------------------------------------------",
    ]
    cur = data.get("currency", "")
    for row in data.get("lines", []) or []:
        name = str(row.get("name", ""))[:34].ljust(34)
        qty = str(row.get("qty", "")).rjust(4)
        amount = f"{row.get('amount', 0):,} {cur}".rjust(16)
        lines.append(f"{name} {qty} {amount}")
    lines.append("--------------------------------------------------------")
    lines.append(f"Subtotal : {data.get('subtotal', 0):,} {cur}")
    lines.append(f"Tax      : {data.get('tax', 0):,} {cur}")
    lines.append(f"Total    : {data.get('total', 0):,} {cur}")
    if data.get("note"):
        lines += ["", str(data["note"])]
    return lines


def _build_pdf(text_lines: list[str]) -> bytes:
    """テキスト行を 1 ページ PDF（A4 相当 595x842・Helvetica 11pt）に組む最小ライタ。"""
    content_parts = ["BT", "/F1 11 Tf", "14 TL", "1 0 0 1 56 786 Tm"]
    for i, ln in enumerate(text_lines):
        if i > 0:
            content_parts.append("T*")  # 行送り（leading=14）
        content_parts.append(f"({_esc(ln)}) Tj")
    content_parts.append("ET")
    content = "\n".join(content_parts).encode("latin-1")

    objs: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_pos = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\n" % (len(objs) + 1)
    out += b"startxref\n%d\n%%%%EOF\n" % xref_pos
    return bytes(out)


class FallbackPdfRenderer:
    """純 Python レンダラ＝report_key に関わらず `data` を素朴な PDF に落とす（Jasper 不要）。

    MVP は請求書のみ＝請求書 payload を既知フォーマットで組む。未知キーでも text 化はできる（best-effort）。
    """

    def render(self, report_key: str, data: dict, fmt: str) -> bytes:
        return _build_pdf(_invoice_lines(data))
