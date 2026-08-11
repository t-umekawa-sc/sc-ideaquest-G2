// profile 機能の API（§4.1・lib/api 経由）。正＝doc/API設計/K_プロフィール・背景画像.md K.1/K.2。
import { apiFetch } from "@/lib/api/client";
import type { MeProfile, MeUpdateInput } from "./types";

export function getMe(): Promise<MeProfile | null> {
  return apiFetch<MeProfile>("/me");
}

// 表示名・ロケールの編集（allowlist＝display_name/locale のみ）。CSRF は apiFetch が付与。
export function updateMe(body: MeUpdateInput): Promise<MeProfile | null> {
  return apiFetch<MeProfile>("/me", { method: "PATCH", body: JSON.stringify(body) });
}
