"""ビルド時ウォームアップ＝jrxml を実際にレンダリングして (a) JasperStarter/JVM 資産をベイク（閉域/再現性・
§17.2）(b) テンプレートのコンパイル妥当性を build 時に検証（壊れていれば build を落とす＝fail-fast）。
"""
import json
import os
import tempfile

from pyreportjasper import PyReportJasper

from app import REPORTS_DIR, _invoice_view

_SAMPLE = {
    "company_code": "ACME-01", "company_name": "Acme Inc.", "period": "2026-09",
    "currency": "JPY", "issued_at": "2026-09-28",
    "lines": [{"name": "Base plan", "qty": 1, "unit_price": 30000, "amount": 30000}],
    "subtotal": 30000, "tax": 3000, "total": 33000, "note": "warmup",
}

json_data, params, json_query = _invoice_view(_SAMPLE)
workdir = tempfile.mkdtemp(prefix="warmup-")
data_file = os.path.join(workdir, "data.json")
with open(data_file, "w", encoding="utf-8") as fh:
    json.dump(json_data, fh, ensure_ascii=False)
out_base = os.path.join(workdir, "report")

jasper = PyReportJasper()
jasper.config(
    os.path.join(REPORTS_DIR, "company_usage_invoice.jrxml"),
    out_base,
    output_formats=["pdf"],
    parameters=params,
    db_connection={"driver": "json", "data_file": data_file, "json_query": json_query},
)
jasper.process_report()
out_pdf = f"{out_base}.pdf"
assert os.path.isfile(out_pdf) and os.path.getsize(out_pdf) > 100, "warmup render failed"
print("warmup OK:", os.path.getsize(out_pdf), "bytes")
