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

// 論理削除（管理者/contest_create・backing quest も論理削除・子データは監査保持）。CSRF は apiFetch が付与。
export function deleteContest(id: string): Promise<null> {
  return apiFetch<null>(`/contests/${id}`, { method: "DELETE" });
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

export type ContestParticipant = components["schemas"]["ContestParticipantDTO"];

// Tier1 参加者一覧（パーティタブ・運営のみ）。
export async function getContestParticipants(id: string, signal?: AbortSignal): Promise<ContestParticipant[]> {
  const res = await apiFetch<{ data: ContestParticipant[] }>(`/contests/${id}/participants`, { signal });
  return res?.data ?? [];
}

// Tier1 参加の承認/却下/排除（運営・T.2）。rejected で参加中メンバーを排除（論理削除）。CSRF は apiFetch が付与。
export function decideContestParticipation(id: string, userId: string, status: "approved" | "rejected"): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/contests/${id}/participation/${userId}`, {
    method: "PATCH", body: JSON.stringify({ status }),
  });
}

// 参加者に審査員（contest_evaluator）を付与/剥奪（パーティタブ・運営）。
export function setContestEvaluator(id: string, userId: string, granted: boolean): Promise<{ granted: boolean } | null> {
  return apiFetch<{ granted: boolean }>(`/contests/${id}/participants/${userId}/evaluator`, {
    method: "PATCH", body: JSON.stringify({ granted }),
  });
}
