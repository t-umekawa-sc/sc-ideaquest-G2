// アイデアコンテスト（ドメイン T・FR-46）の API クライアント。公開性は会社 access_mode 一本化。
import { apiFetch, idempotencyHeader } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ContestListItem = components["schemas"]["ContestListItem"];
export type ContestDetail = components["schemas"]["ContestDetail"];
export type ContestIdeaFlag = components["schemas"]["ContestIdeaFlagDTO"];
export type ContestCreateInput = components["schemas"]["ContestCreateRequest"];
export type ContestUpdateInput = components["schemas"]["ContestUpdateRequest"];
export type ContestRanking = components["schemas"]["ContestRankingResponse"];
export type ContestRankingEntry = components["schemas"]["ContestRankingEntry"];
export type ContestFinalizeResult = components["schemas"]["ContestFinalizeResponse"];

export async function fetchContests(status?: string, signal?: AbortSignal): Promise<ContestListItem[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await apiFetch<{ data: ContestListItem[] }>(`/contests${qs}`, { signal });
  return res?.data ?? [];
}

export function getContest(id: string, signal?: AbortSignal): Promise<ContestDetail | null> {
  return apiFetch<ContestDetail>(`/contests/${id}`, { signal });
}

export function createContest(input: ContestCreateInput): Promise<ContestDetail | null> {
  return apiFetch<ContestDetail>("/contests", { method: "POST", body: JSON.stringify(input) });
}

export function updateContest(id: string, input: ContestUpdateInput): Promise<ContestDetail | null> {
  return apiFetch<ContestDetail>(`/contests/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

// 会期スコープのランキング（T.3）。axis＝approve_votes/avg_score/contribution。
export function getContestRanking(
  id: string, axis: string, signal?: AbortSignal,
): Promise<ContestRanking | null> {
  return apiFetch<ContestRanking>(`/contests/${id}/ranking?axis=${encodeURIComponent(axis)}`, { signal });
}

// Tier1 参加リクエスト（本人・T.2）。public/DEMO は自動 approved、社内は管理者承認待ち。
export function requestContestParticipation(id: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/contests/${id}/participation`, {
    method: "POST", headers: idempotencyHeader(),
  });
}

// 表彰確定（管理者・冪等・T.1）。judging→closed・上位N へ付与。
export function finalizeContest(id: string): Promise<ContestFinalizeResult | null> {
  return apiFetch<ContestFinalizeResult>(`/contests/${id}/finalize`, {
    method: "POST", headers: idempotencyHeader(),
  });
}
