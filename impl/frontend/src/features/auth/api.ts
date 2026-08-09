// auth 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/A_認証・セッション.md。
import { apiFetch } from "@/lib/api/client";
import type { LoginResponse, PasswordSetupVerifyResponse } from "./types";

export function login(companyCode: string, loginId: string, password: string): Promise<LoginResponse | null> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ company_code: companyCode, login_id: loginId, password }),
  });
}

export function logout(): Promise<null> {
  return apiFetch<null>("/auth/logout", { method: "POST" }) as Promise<null>;
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
