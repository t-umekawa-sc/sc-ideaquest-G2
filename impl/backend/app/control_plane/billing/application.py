"""使用料請求書のユースケース（ドメイン V.1・SC-92・同期ストリーム）。

責務＝① 入力検証（period/format・§4.7）② 認可テナント境界（他社は存在秘匿 404）③ 請求書データ組み立て
（domain・純粋）④ レンダラ選択（infra/reports・env）⑤ 監査（§17.5 G3＝誰が/どの会社の/どの期間を DL したか・
本文は残さない）。描画は port 越し＝Jasper 到達不能は 502、機能オフ（none）は 503 に写像する。
"""
from __future__ import annotations

import re
import uuid

from app.control_plane.audit import repository as audit
from app.control_plane.auth.orm import Company
from app.control_plane.billing.domain import invoice as invoice_domain
from app.core.errors import AppError
from app.db.control import control_session
from app.infra.reports import registry
from app.infra.reports.errors import ReportConfigError, ReportUnavailable

_PERIOD_RE = re.compile(r"^\d{4}-\d{2}$")           # YYYY-MM（§4.7・V.1）
_REPORT_KEY = "company_usage_invoice"               # サーバー内部固定（クライアント入力を受けない＝R5）


def _validate_period(period: str) -> str:
    """`period` を `YYYY-MM` で検証（不正は 422・field=period）。月（01-12）も検証する。"""
    if not period or not _PERIOD_RE.match(period):
        raise AppError(422, "invalid_period", detail="period は YYYY-MM 形式で指定してください",
                       errors=[{"field": "period"}])
    month = int(period[5:7])
    if not (1 <= month <= 12):
        raise AppError(422, "invalid_period", detail="period の月は 01〜12 です",
                       errors=[{"field": "period"}])
    return period


def _validate_format(fmt: str) -> str:
    """出力形式をホワイトリスト検証（未対応は 422・field=format）。初期は pdf のみ（§V.1）。"""
    if fmt not in registry.SUPPORTED_FORMATS:
        raise AppError(422, "unsupported_format", detail="対応していない出力形式です",
                       errors=[{"field": "format"}])
    return fmt


def render_invoice(company_id: uuid.UUID, *, period: str, fmt: str, session: dict) -> tuple[bytes, str, str]:
    """使用料請求書を描画してバイト列＋ファイル名＋MIME を返す（同期ストリーム・V.1）。

    認可＝ロールは router（`company_account_admin`/`system_admin`）で担保済み。ここでは**テナント境界**を
    enforce＝`system_admin` は全社可、`company_account_admin` は自社のみ（他社 `{id}` は存在秘匿で 404）。
    """
    period = _validate_period(period)
    fmt = _validate_format(fmt)

    # テナント境界（§1.5）＝system_admin 以外は自社固定。他社 id は存在を伏せて 404。
    is_system_admin = session.get("system_role") == "system_admin"
    if not is_system_admin and str(company_id) != session.get("company_id"):
        raise AppError(404, "not_found")

    with control_session() as s:
        company = s.get(Company, company_id)
        if company is None:
            raise AppError(404, "not_found")
        company_code, company_name = company.company_code, company.name

    data = invoice_domain.build(company_code, company_name, period)

    renderer = registry.get_renderer()
    if renderer is None:  # REPORT_RENDERER=none ＝機能オフ（フロントはボタン非活性・設計 §13）
        raise AppError(503, "report_disabled", detail="帳票機能は現在無効です")

    try:
        report_key = registry.resolve_template(_REPORT_KEY)  # ホワイトリスト解決（R5）
        content = renderer.render(report_key, data.to_payload(), fmt)
    except ReportConfigError as exc:  # サーバー内部固定キーゆえ通常起きない（設定不整合）＝500
        raise AppError(500, "report_config_error", detail=str(exc)) from exc
    except ReportUnavailable as exc:  # Jasper 到達不能/描画失敗＝502（再試行可）
        raise AppError(502, "report_backend_unavailable",
                       detail="帳票サービスに到達できませんでした。時間をおいて再試行してください。") from exc

    # 監査（G3）＝機微な管理者操作。誰が/どの会社の/どの期間/形式を DL したか。本文（金額）は残さない。
    audit.record("billing.invoice_download", {
        "company_id": str(company_id), "company_code": company_code, "period": period, "format": fmt,
    })

    filename = f"invoice-{company_code}-{period}.{fmt}"
    mime = "application/pdf" if fmt == "pdf" else "application/octet-stream"
    return content, filename, mime
