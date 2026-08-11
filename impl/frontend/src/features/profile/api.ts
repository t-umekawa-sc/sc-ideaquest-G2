// profile 機能の API（§4.1・lib/api 経由）。正＝doc/API設計/K_プロフィール・背景画像.md K.1/K.2。
import { apiFetch } from "@/lib/api/client";
import type { EmailChangeInput, MeProfile, MeUpdateInput, PasswordChangeInput } from "./types";

export function getMe(): Promise<MeProfile | null> {
  return apiFetch<MeProfile>("/me");
}

// 表示名・ロケールの編集（allowlist＝display_name/locale のみ）。CSRF は apiFetch が付与。
export function updateMe(body: MeUpdateInput): Promise<MeProfile | null> {
  return apiFetch<MeProfile>("/me", { method: "PATCH", body: JSON.stringify(body) });
}

// 自己パスワード変更（K.3・現在PW 再認証）。成功で全セッション破棄＝要再ログイン（204）。
export function changePassword(body: PasswordChangeInput): Promise<null> {
  return apiFetch<null>("/me/password", { method: "POST", body: JSON.stringify(body) }) as Promise<null>;
}

// 自己メール変更（K.3・現在PW 再認証・会社内一意）。
export function changeEmail(body: EmailChangeInput): Promise<MeProfile | null> {
  return apiFetch<MeProfile>("/me/email", { method: "POST", body: JSON.stringify(body) });
}
