"""認証ルータ（imperative shell）。HTTP・Cookie・検証順序のみ。業務判断は application/domain。

レスポンスは型付きモデル（schemas）を返し OpenAPI に反映する。Cookie は注入した Response に設定
（FastAPI がモデル本文＋Cookie ヘッダをまとめて返す）。
"""
from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.control_plane.auth import application as auth_service
from app.control_plane.auth.schemas import (
    AcceptedResponse,
    LoginRequest,
    LoginResponse,
    MfaChallenge,
    MfaResendResponse,
    MfaVerifyReq,
    OkResponse,
    PasswordSetupCompleteReq,
    PasswordSetupRequestReq,
    PasswordSetupVerifyReq,
    PasswordSetupVerifyResponse,
    Session,
)
from app.core.config import get_settings
from app.core.deps import require_preauth, require_session, verify_csrf, verify_origin
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


def _set_preauth_cookies(response: Response, preauth_token: str, csrf_token: str) -> None:
    """要MFA 時＝pre-auth（最小権限）＋CSRF を発行。本セッション（iq_session）はまだ張らない（A.0-②/43）。"""
    s = get_settings()
    response.set_cookie(
        "iq_preauth", preauth_token, httponly=True, secure=s.cookie_secure, samesite="lax", path="/"
    )
    response.set_cookie(
        "iq_csrf", csrf_token, httponly=False, secure=s.cookie_secure, samesite="lax", path="/"
    )


def _set_trust_cookie(response: Response, trust_token: str) -> None:
    """信頼端末トークン（iq_trust・30日・httpOnly）。次回 login で MFA スキップ照合に使う（A.0-①）。"""
    s = get_settings()
    response.set_cookie(
        "iq_trust", trust_token, httponly=True, secure=s.cookie_secure, samesite="lax", path="/",
        max_age=s.trusted_device_ttl_seconds,
    )


@router.post("/login", response_model=LoginResponse, response_model_exclude_none=True)
def login(body: LoginRequest, request: Request, response: Response) -> LoginResponse:
    verify_origin(request)  # login は CSRF 免除・Origin/Sec-Fetch のみ（A.1）
    client_ip = request.client.host if request.client else "unknown"
    result = auth_service.login(
        get_redis(), client_ip, body.company_code, body.login_id, body.password,
        trust_token=request.cookies.get("iq_trust"),
    )
    if result.status == "mfa_required":
        # 要MFA＝pre-auth＋CSRF を発行（本セッションはまだ張らない・A.0-②）
        _set_preauth_cookies(response, result.preauth_token, result.csrf_token)
        return LoginResponse(status="mfa_required", mfa=MfaChallenge(**result.mfa))
    _set_auth_cookies(response, result.session_token, result.csrf_token)
    return LoginResponse(status="authenticated", session=Session(**result.session))


@router.post("/mfa/verify", response_model=LoginResponse, response_model_exclude_none=True)
def mfa_verify(body: MfaVerifyReq, request: Request, response: Response) -> LoginResponse:
    # pre-auth（401）→ Origin → CSRF（403）の順（認証を CSRF より先に評価・A-TC-014/015 と同方針）
    preauth_token, preauth = require_preauth(request)
    verify_origin(request)
    verify_csrf(request)
    result = auth_service.verify_mfa(
        get_redis(), preauth_token, preauth, body.code, body.trust_device
    )
    _set_auth_cookies(response, result.session_token, result.csrf_token)
    response.delete_cookie("iq_preauth", path="/")  # pre-auth 消費（A.0-③）
    if result.trust_token:
        _set_trust_cookie(response, result.trust_token)
    return LoginResponse(status="authenticated", session=Session(**result.session))


@router.post("/mfa/resend", response_model=MfaResendResponse)
def mfa_resend(request: Request) -> MfaResendResponse:
    preauth_token, preauth = require_preauth(request)
    verify_origin(request)
    verify_csrf(request)
    result = auth_service.resend_mfa(get_redis(), preauth_token, preauth)
    return MfaResendResponse(**result)


@router.post("/logout-all", status_code=204)
def logout_all(request: Request) -> Response:
    require_session(request)          # 認証を先に（無ければ 401）
    verify_origin(request)
    verify_csrf(request)              # その後 CSRF（403）
    auth_service.logout_all(get_redis(), request.cookies.get("iq_session"))
    response = Response(status_code=204)
    response.delete_cookie("iq_session", path="/")
    response.delete_cookie("iq_csrf", path="/")
    response.delete_cookie("iq_trust", path="/")
    return response


@router.get("/session", response_model=Session)
def get_session(request: Request) -> Session:
    # セッション必須（無ければ 401）。GET は CSRF 不要（A.1）。応答は A.6 のみ（内部フィールドは返さない）
    payload = auth_service.get_session(get_redis(), request.cookies.get("iq_session"))
    return Session(**payload)


@router.post("/password-setup/request", response_model=AcceptedResponse, status_code=202)
def password_setup_request(body: PasswordSetupRequestReq, request: Request) -> AcceptedResponse:
    # 未認証起点＝CSRF 免除・Origin/Sec-Fetch のみ（A.7）。応答は常に 202（列挙耐性）
    verify_origin(request)
    client_ip = request.client.host if request.client else "unknown"
    auth_service.request_password_setup(get_redis(), client_ip, body.company_code, body.login_id)
    return AcceptedResponse()


@router.post("/password-setup/verify", response_model=PasswordSetupVerifyResponse)
def password_setup_verify(body: PasswordSetupVerifyReq, request: Request) -> PasswordSetupVerifyResponse:
    # リンクの有効性確認（状態Bの表示可否）。未認証起点＝Origin のみ。無効/期限切れ/使用済は 410
    verify_origin(request)
    result = auth_service.verify_password_setup(body.token)
    return PasswordSetupVerifyResponse(**result)


@router.post("/password-setup/complete", response_model=OkResponse)
def password_setup_complete(body: PasswordSetupCompleteReq, request: Request) -> OkResponse:
    # 新PW設定。未認証起点＝Origin のみ。ポリシー違反 422／トークン無効 410／成功で全セッション破棄
    verify_origin(request)
    auth_service.complete_password_setup(get_redis(), body.token, body.new_password)
    return OkResponse()


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
