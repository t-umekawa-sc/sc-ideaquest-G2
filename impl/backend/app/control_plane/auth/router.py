"""認証ルータ（imperative shell）。HTTP・Cookie・検証順序のみ。業務判断は application/domain。"""
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app.control_plane.auth import application as auth_service
from app.control_plane.auth.schemas import LoginRequest
from app.core.config import get_settings
from app.core.deps import require_session, verify_csrf, verify_origin
from app.infra.cache import get_redis

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _set_auth_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    s = get_settings()
    # iq_session: httpOnly（JS から読めない・XSS 対策・A.0）
    response.set_cookie(
        "iq_session", session_token, httponly=True, secure=s.cookie_secure, samesite="lax", path="/"
    )
    # iq_csrf: 非httpOnly（ダブルサブミットで JS が読んでヘッダに載せる・A.0）
    response.set_cookie(
        "iq_csrf", csrf_token, httponly=False, secure=s.cookie_secure, samesite="lax", path="/"
    )


@router.post("/login")
def login(body: LoginRequest, request: Request) -> Response:
    verify_origin(request)  # login は CSRF 免除・Origin/Sec-Fetch のみ（A.1）
    client_ip = request.client.host if request.client else "unknown"
    result = auth_service.login(
        get_redis(), client_ip, body.company_code, body.login_id, body.password
    )
    if result.status == "mfa_required":
        return JSONResponse({"status": "mfa_required", "mfa": result.mfa})
    response = JSONResponse({"status": "authenticated", "session": result.session})
    _set_auth_cookies(response, result.session_token, result.csrf_token)
    return response


@router.get("/session")
def get_session(request: Request) -> dict:
    # セッション必須（無ければ 401）。GET は CSRF 不要（A.1）。応答は A.6 のみ（内部フィールドは返さない）
    return auth_service.get_session(get_redis(), request.cookies.get("iq_session"))


@router.post("/logout", status_code=204)
def logout(request: Request) -> Response:
    require_session(request)          # 認証を先に（無ければ 401・A-TC-015）
    verify_origin(request)
    verify_csrf(request)              # その後 CSRF（403・A-TC-014）
    token = request.cookies.get("iq_session")
    auth_service.logout(get_redis(), token)
    response = Response(status_code=204)
    response.delete_cookie("iq_session", path="/")
    response.delete_cookie("iq_csrf", path="/")
    return response
