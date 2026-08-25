// achievements 機能の API 呼び出し（§4.1・lib/api 経由）。正＝ドメイン G.4・SC-40。
// backend＝GET /achievements（マスタ＋自分の獲得/進捗＋summary・シークレット未獲得は伏せる）・GET /me/achievements。
// 付与はサーバー（台帳フック）が自動判定＝フロントは表示のみ。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type AchievementDTO = components["schemas"]["AchievementDTO"];
export type AchievementListResponse = components["schemas"]["AchievementListResponse"];

export function getAchievements(params?: { category?: string; state?: string }): Promise<AchievementListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.state) qs.set("state", params.state);
  const q = qs.toString();
  return apiFetch<AchievementListResponse>(`/achievements${q ? `?${q}` : ""}`);
}
