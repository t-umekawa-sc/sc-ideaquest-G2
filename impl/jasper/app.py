"""Jasper レンダリングサービス（内部 S2S・データ・プッシュ JSON）。

提供サンプル（v_pythonjasper）を本番統合向けに作り直したもの＝R1〜R7／§17 の指摘を反映：
- **DB 直結を全廃**（config.ini/JDBC/drivers 不要）＝JSON データソース（`db_connection.driver='json'`）。
- **GET /generate（query＋パストラバーサル）→ POST /render（JSON body＋report_key ホワイトリスト）**。
- **認証**＝`X-Report-Secret`（共有シークレット・サンプルの未実装 TODO を埋める）。CORS は付けない（S2S）。
- **一時ファイル**＝`tempfile.mkdtemp()` で一意化し `finally` で削除（`/tmp/固定名` の衝突回避）。
- **エラー漏洩**＝例外詳細はログのみ・レスポンスは定型メッセージ。

「何を印字するか」の整形（金額フォーマット等）は report_key 別の view マッピングで担い、jrxml は文字列を
描くだけに保つ（型変換の不確実性回避）。backend から渡る `data` は業務データ（ドメイン非依存の dict）。
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from pyreportjasper import PyReportJasper

logger = logging.getLogger("jasper")
logging.basicConfig(level=logging.INFO)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
SHARED_SECRET = os.environ.get("JASPER_SHARED_SECRET", "")

app = FastAPI(title="IdeaQuest Jasper Renderer")

_FORMATS = {"pdf": "application/pdf"}


class RenderRequest(BaseModel):
    report_key: str
    format: str = "pdf"
    data: dict = {}


def _money(value, currency: str) -> str:
    try:
        return f"{int(value):,} {currency}".strip()
    except (TypeError, ValueError):
        return f"{value} {currency}".strip()


def _invoice_view(data: dict) -> tuple[dict, dict, str]:
    """使用料請求書の presentation マッピング＝(json データ, パラメータ, json_query)。

    金額/数量の整形はここで実施し、jrxml は文字列を描くだけに保つ（型変換の沼回避）。新しい帳票を増やす時は
    本関数と同形の view を足し `_REPORTS` に登録する（jrxml は `reports/<report_key>.jrxml` に配置）。
    """
    cur = str(data.get("currency", ""))
    lines = [
        {
            "name": str(row.get("name", "")),
            "qty": str(row.get("qty", "")),
            "unit": _money(row.get("unit_price", 0), cur),
            "amount": _money(row.get("amount", 0), cur),
        }
        for row in (data.get("lines") or [])
    ]
    params = {
        "COMPANY_CODE": str(data.get("company_code", "")),
        "COMPANY_NAME": str(data.get("company_name", "")),
        "PERIOD": str(data.get("period", "")),
        "ISSUED_AT": str(data.get("issued_at", "")),
        "SUBTOTAL": _money(data.get("subtotal", 0), cur),
        "TAX": _money(data.get("tax", 0), cur),
        "TOTAL": _money(data.get("total", 0), cur),
        "NOTE": str(data.get("note", "")),
    }
    return {"lines": lines}, params, "lines"


# report_key ホワイトリスト（R5 の多層防御＝backend registry に加え Jasper 側でも固定）。
_REPORTS = {"company_usage_invoice": _invoice_view}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/render")
def render(req: RenderRequest, x_report_secret: str | None = Header(default=None)) -> Response:
    # S2S 認証（R3）＝共有シークレット一致。未設定運用（空）は拒否（fail-closed）。
    if not SHARED_SECRET or x_report_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")
    # report_key ホワイトリスト（R5）＝未知キー/パス的入力はここで弾く（reports/ の外に出さない）。
    view = _REPORTS.get(req.report_key)
    if view is None:
        raise HTTPException(status_code=400, detail="unknown report_key")
    fmt = (req.format or "pdf").lower()
    if fmt not in _FORMATS:
        raise HTTPException(status_code=400, detail="unsupported format")
    jrxml = os.path.join(REPORTS_DIR, f"{req.report_key}.jrxml")
    if not os.path.isfile(jrxml):
        logger.error("template missing: %s", jrxml)
        raise HTTPException(status_code=500, detail="template unavailable")

    json_data, params, json_query = view(req.data)
    workdir = tempfile.mkdtemp(prefix="jasper-")  # テナント間衝突回避（§17.3.1）＝一意ディレクトリ
    try:
        data_file = os.path.join(workdir, "data.json")
        with open(data_file, "w", encoding="utf-8") as fh:
            json.dump(json_data, fh, ensure_ascii=False)
        output_base = os.path.join(workdir, "report")
        jasper = PyReportJasper()
        jasper.config(
            jrxml,
            output_base,
            output_formats=[fmt],
            parameters=params,
            db_connection={"driver": "json", "data_file": data_file, "json_query": json_query},
        )
        jasper.process_report()
        out_path = f"{output_base}.{fmt}"
        if not os.path.isfile(out_path):
            logger.error("jasper produced no output: %s", out_path)
            raise HTTPException(status_code=500, detail="render failed")
        with open(out_path, "rb") as fh:
            content = fh.read()
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001（例外詳細はログのみ・レスポンスは定型＝漏洩防止 R/§17.3.7）
        logger.exception("render error report_key=%s", req.report_key)
        raise HTTPException(status_code=500, detail="render failed")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)  # 一時ファイルを必ず破棄（R6）
    return Response(content=content, media_type="application/octet-stream")
