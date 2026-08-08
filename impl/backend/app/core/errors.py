"""RFC7807 problem+json エラー（API設計 README §1.7）。

`code`（機械可読）で分岐。全コードの網羅は OpenAPI が SoT（§1.7）＝本モジュールは表現のみ。
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# code -> 既定 title（人間可読・表示用の当たり）
_TITLES = {
    "unauthenticated": "Unauthenticated",
    "forbidden": "Forbidden",
    "csrf_failed": "CSRF validation failed",
    "not_found": "Not Found",
    "validation_error": "Validation failed",
    "rate_limited": "Too Many Requests",
    "company_suspended": "Company Suspended",
}


class AppError(Exception):
    """アプリ定義のエラー。ハンドラが problem+json に変換する。"""

    def __init__(self, status: int, code: str, detail: str | None = None, errors: list | None = None):
        self.status = status
        self.code = code
        self.detail = detail
        self.errors = errors
        super().__init__(f"{status} {code}")


def _problem(request: Request, status: int, code: str, detail: str | None, errors: list | None) -> JSONResponse:
    body = {
        "type": "about:blank",
        "title": _TITLES.get(code, code),
        "status": status,
        "code": code,
        "request_id": getattr(request.state, "request_id", None),
    }
    if detail is not None:
        body["detail"] = detail
    if errors is not None:
        body["errors"] = errors
    return JSONResponse(status_code=status, content=body, media_type="application/problem+json")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):  # noqa: ANN202
        return _problem(request, exc.status, exc.code, exc.detail, exc.errors)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):  # noqa: ANN202
        errors = [
            {
                "field": ".".join(str(p) for p in e.get("loc", []) if p != "body"),
                "code": e.get("type", "invalid"),
                "message": e.get("msg", ""),
            }
            for e in exc.errors()
        ]
        return _problem(request, 422, "validation_error", "入力値が不正です", errors)
