// auth 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/A_認証・セッション.md。
import { apiFetch } from "@/lib/api/client";
import type { LoginResponse } from "./types";

export function login(companyCode: string, loginId: string, password: string): Promise<LoginResponse | null> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ company_code: companyCode, login_id: loginId, password }),
  });
}

export function logout(): Promise<null> {
  return apiFetch<null>("/auth/logout", { method: "POST" }) as Promise<null>;
}
