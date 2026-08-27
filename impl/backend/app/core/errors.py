"""RFC7807 problem+json エラー（API設計 README §1.7）。

`code`（機械可読）で分岐。全コードの網羅は OpenAPI が SoT（§1.7）＝本モジュールは表現のみ。
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.locale import resolve_request_locale

# code -> 既定 title（人間可読・表示用の当たり）。locale 別（§2.1）。機械可読の正は `code`（§1.7）。
_TITLES_EN = {
    "unauthenticated": "Unauthenticated",
    "forbidden": "Forbidden",
    "csrf_failed": "CSRF validation failed",
    "not_found": "Not Found",
    "validation_error": "Validation failed",
    "rate_limited": "Too Many Requests",
    "company_suspended": "Company Suspended",
    "token_expired": "Token Expired",
    "edit_conflict": "Edit Conflict",
    "idempotency_in_progress": "Idempotency In Progress",
    "idempotency_key_reuse": "Idempotency Key Reuse",
    "otp_invalid": "OTP Invalid",
    "otp_expired": "OTP Expired",
    "preauth_expired": "Pre-auth Expired",
}
_TITLES_JA = {
    "unauthenticated": "未認証",
    "forbidden": "権限がありません",
    "csrf_failed": "CSRF 検証に失敗しました",
    "not_found": "見つかりません",
    "validation_error": "入力値が不正です",
    "rate_limited": "リクエストが多すぎます",
    "company_suspended": "会社が停止中です",
    "token_expired": "トークンの有効期限が切れています",
    "edit_conflict": "編集が競合しました",
    "idempotency_in_progress": "処理中です",
    "idempotency_key_reuse": "冪等キーが再利用されました",
    "otp_invalid": "認証コードが不正です",
    "otp_expired": "認証コードの有効期限が切れています",
    "preauth_expired": "認証の有効期限が切れています",
}


def _title(code: str, locale: str) -> str:
    titles = _TITLES_EN if locale == "en" else _TITLES_JA  # 既定 ja（§2.1）
    return titles.get(code, code)


class AppError(Exception):
    """アプリ定義のエラー。ハンドラが problem+json に変換する。"""

    def __init__(
        self,
        status: int,
        code: str,
        detail: str | None = None,
        errors: list | None = None,
        extra: dict | None = None,
        headers: dict | None = None,
    ):
        self.status = status
        self.code = code
        self.detail = detail
        self.errors = errors
        self.extra = extra  # code 固有の追加メンバー（例 otp_invalid の attempts_left・A.1）
        self.headers = headers  # 追加ヘッダ（例 429 の Retry-After・A.1）
        super().__init__(f"{status} {code}")


def _problem(
    request: Request, status: int, code: str, detail: str | None, errors: list | None,
    extra: dict | None = None, headers: dict | None = None,
) -> JSONResponse:
    body = {
        "type": "about:blank",
        "title": _title(code, resolve_request_locale(request)),
        "status": status,
        "code": code,
        "request_id": getattr(request.state, "request_id", None),
    }
    if detail is not None:
        body["detail"] = detail
    if errors is not None:
        body["errors"] = errors
    if extra:
        body.update(extra)
    return JSONResponse(
        status_code=status, content=body, media_type="application/problem+json", headers=headers
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):  # noqa: ANN202
        return _problem(request, exc.status, exc.code, exc.detail, exc.errors, exc.extra, exc.headers)

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
        detail = "Invalid input" if resolve_request_locale(request) == "en" else "入力値が不正です"
        return _problem(request, 422, "validation_error", detail, errors)
