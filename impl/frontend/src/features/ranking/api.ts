// ranking 機能の API 呼び出し（§4.1・lib/api 経由）。正＝ドメイン G.5・§7（SC-41 全社ランキング）。
// backend＝GET /rankings（period × scope・獲得XP＋獲得コイン集計・me 常時同梱）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type RankingResponse = components["schemas"]["RankingResponse"];
export type RankingRow = components["schemas"]["RankingRowDTO"];
export type RankingMe = components["schemas"]["RankingMeDTO"];
export type RankingPeriod = "this_week" | "last_week" | "this_month" | "all";

// ランキング取得（SC-41 全社＝scope 既定 company）。period は this_week/last_week/this_month/all。
export function getRankings(period: RankingPeriod, params?: { scope?: string; limit?: number; cursor?: string }): Promise<RankingResponse | null> {
  const qs = new URLSearchParams();
  qs.set("period", period);
  qs.set("scope", params?.scope ?? "company");
  qs.set("limit", String(params?.limit ?? 100));
  if (params?.cursor) qs.set("cursor", params.cursor);
  return apiFetch<RankingResponse>(`/rankings?${qs.toString()}`);
}
