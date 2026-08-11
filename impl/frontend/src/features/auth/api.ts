// auth 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/A_認証・セッション.md。
import { apiFetch } from "@/lib/api/client";
import type { LoginResponse, MfaResendResponse, PasswordSetupVerifyResponse } from "./types";

export function login(companyCode: string, loginId: string, password: string): Promise<LoginResponse | null> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ company_code: companyCode, login_id: loginId, password }),
  });
}

export function logout(): Promise<null> {
  return apiFetch<null>("/auth/logout", { method: "POST" }) as Promise<null>;
}

// 全端末ログアウト＋信頼端末失効（A.0-⑤＝全端末で次回 MFA 必須）。204→null。CSRF は apiFetch が付与。
export function logoutAll(): Promise<null> {
  return apiFetch<null>("/auth/logout-all", { method: "POST" }) as Promise<null>;
}

// 状態C: pre-auth 中の OTP 検証（CSRF＋Origin 必須＝iq_csrf を X-CSRF-Token に載せる・apiFetch が付与）。
// 成功で authenticated（本セッション発行）。otp_invalid は attempts_left、410/401 は再送/再ログイン案内。
export function verifyMfa(code: string, trustDevice: boolean): Promise<LoginResponse | null> {
  return apiFetch<LoginResponse>("/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({ code, trust_device: trustDevice }),
  });
}

// 状態C: OTP 再送（クールダウン中は 429 rate_limited）。旧OTP失効・新OTP送信。
export function resendMfa(): Promise<MfaResendResponse | null> {
  return apiFetch<MfaResendResponse>("/auth/mfa/resend", { method: "POST" });
}

// 状態D: 自己サービス再設定要求。応答は常に 202 accepted（列挙耐性・A.7）。呼び出し側は成否を区別しない。
export function requestPasswordSetup(companyCode: string, loginId: string): Promise<null> {
  return apiFetch("/auth/password-setup/request", {
    method: "POST",
    body: JSON.stringify({ company_code: companyCode, login_id: loginId }),
  }) as Promise<null>;
}

// 状態B: リンクの有効性確認（表示可否）。無効/期限切れ/使用済は 410（ApiError code=token_expired）。
export function verifyPasswordSetup(token: string): Promise<PasswordSetupVerifyResponse | null> {
  return apiFetch<PasswordSetupVerifyResponse>("/auth/password-setup/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

// 状態B: 新PW設定。ポリシー違反は 422（errors[]）・トークン無効は 410。成功で全セッション破棄（新規発行なし）。
export function completePasswordSetup(token: string, newPassword: string): Promise<null> {
  return apiFetch("/auth/password-setup/complete", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  }) as Promise<null>;
}
