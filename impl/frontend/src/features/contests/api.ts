// アイデアコンテスト（ドメイン T・FR-46）の API クライアント。公開性は会社 access_mode 一本化。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ContestListItem = components["schemas"]["ContestListItem"];
export type ContestDetail = components["schemas"]["ContestDetail"];
export type ContestCreateInput = components["schemas"]["ContestCreateRequest"];
export type ContestUpdateInput = components["schemas"]["ContestUpdateRequest"];

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
