"""請求書ルータ（`/api/v1/admin/companies/{id}/billing/*`・ドメイン V.1・imperative shell）。

認可＝`company_account_admin`/`system_admin`（V.0）。ダウンロードは GET（状態変更なし）ゆえ CSRF 免除。
業務判断（検証/テナント境界/レンダラ選択）は application 層。レスポンスは帳票バイト列を attachment で
ストリーム（既存 CSV エクスポートと同形＝同一オリジン GET）。
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response

from app.control_plane.admin.deps import require_company_account_admin
from app.control_plane.billing import application as billing_service

router = APIRouter(prefix="/api/v1/admin", tags=["billing"])


@router.get("/companies/{company_id}/billing/invoice")
def download_invoice(
    company_id: uuid.UUID,
    request: Request,
    period: str,
    format: str = "pdf",
    session: dict = Depends(require_company_account_admin),
) -> Response:
    """使用料請求書 PDF を帳票レンダラで生成し attachment でストリーム返却（V.1・同期）。

    `period`（`YYYY-MM`・必須）・`format`（`pdf` 既定）。他社 `{id}` は存在秘匿で 404。
    """
    content, filename, mime = billing_service.render_invoice(
        company_id, period=period, fmt=format, session=session,
    )
    return Response(
        content=content, media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
