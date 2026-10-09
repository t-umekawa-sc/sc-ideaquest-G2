"""使用料請求書の帳票データ組み立て（純粋・レンダラ非依存＝これが「帳票ロジック」・設計 §6）。

**切り離しの核心**＝ここは「何を印字するか」だけを決め、Jasper/PDF の存在を知らない。`ReportRenderer` port へ
`to_payload()`（JSON 可の dict）を渡すだけで、描画は差し替え可能（データ・プッシュ・設計 §4）。

**MVP＝固定サンプル値**（請求データの実テーブルは未整備）。会社コード/会社名/期間のみ実データ、明細・金額は
サンプル。実データ連携は料金プラン/従量メータリングのテーブル実装時に本関数へ差し込む（I/O なし＝純関数を保つ）。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class InvoiceLine:
    """請求明細1行（品目・数量・単価・金額）。"""

    name: str
    qty: int
    unit_price: int
    amount: int


@dataclass(frozen=True)
class InvoiceReportData:
    """使用料請求書の印字データ（純データ＝レンダラ非依存・JSON 化は `to_payload`）。"""

    company_code: str
    company_name: str
    period: str                 # YYYY-MM
    currency: str
    issued_at: str              # YYYY-MM-DD（period 月末などの擬似値・MVP）
    lines: list[InvoiceLine]
    subtotal: int
    tax: int
    total: int
    note: str = ""
    tax_rate: float = 0.10

    def to_payload(self) -> dict:
        """レンダラ（Jasper への S2S JSON／fallback）へ渡す JSON 可の dict に落とす。"""
        return {
            "company_code": self.company_code,
            "company_name": self.company_name,
            "period": self.period,
            "currency": self.currency,
            "issued_at": self.issued_at,
            "lines": [
                {"name": ln.name, "qty": ln.qty, "unit_price": ln.unit_price, "amount": ln.amount}
                for ln in self.lines
            ],
            "subtotal": self.subtotal,
            "tax": self.tax,
            "tax_rate": self.tax_rate,
            "total": self.total,
            "note": self.note,
        }


# MVP の固定サンプル明細（単価×数量＝金額）。実データ連携時はここをメータリング結果で置き換える。
_SAMPLE_LINES: list[InvoiceLine] = [
    InvoiceLine(name="Base plan (monthly)", qty=1, unit_price=30000, amount=30000),
    InvoiceLine(name="Active accounts", qty=25, unit_price=500, amount=12500),
    InvoiceLine(name="AI jobs (pay-as-you-go)", qty=1200, unit_price=2, amount=2400),
]


def build(company_code: str, company_name: str, period: str, *, currency: str = "JPY") -> InvoiceReportData:
    """会社・期間から請求書データを組み立てる（MVP＝明細は固定サンプル・金額は明細合計から算出）。

    `period`（`YYYY-MM`）の形式検証は application 層（§4.7）で済ませた値を受ける前提。消費税は 10% 固定で算出。
    """
    subtotal = sum(ln.amount for ln in _SAMPLE_LINES)
    tax_rate = 0.10
    tax = int(round(subtotal * tax_rate))
    total = subtotal + tax
    issued_at = f"{period}-28"  # 擬似発行日（MVP＝期間月の月末付近）。実データ連携時に請求確定日へ。
    return InvoiceReportData(
        company_code=company_code, company_name=company_name, period=period, currency=currency,
        issued_at=issued_at, lines=list(_SAMPLE_LINES), subtotal=subtotal, tax=tax, total=total,
        tax_rate=tax_rate,
        note="This is a sample invoice generated for integration purposes (fixed demo values).",
    )
