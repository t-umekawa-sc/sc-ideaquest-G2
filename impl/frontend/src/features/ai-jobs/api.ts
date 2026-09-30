// AIジョブ（ドメイン S・FR-45・SC-04）のデータ源＝backend `tenant/ai_jobs`（API S.1）へ実結線。
// 一覧はサーバー委譲（GET /ai-jobs・DataTable §1.8.1）。
import type { QueryState } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

import type { AiJobDetail, AiJobListResult, AiJobSummary } from "./types";

export const AI_JOBS_CHANGED_EVENT = "ai-jobs-changed";

export function emitAiJobsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_JOBS_CHANGED_EVENT));
}

// ソート可能キー＝backend ホワイトリストに一致（created_at 既定／finished_at）。
const SORTABLE = new Set(["created_at", "finished_at"]);
const ENUM_FILTERS = new Set(["status", "task_type"]);

export function aiJobsListParams(state: QueryState): URLSearchParams {
  const qs = new URLSearchParams();
  const sort = state.sort.filter((s) => SORTABLE.has(s.key)).map((s) => (s.dir === "desc" ? `-${s.key}` : s.key));
  if (sort.length) qs.set("sort", sort.join(","));
  for (const key of Object.keys(state.filters)) {
    const c = state.filters[key];
    if (c.type === "enum" && ENUM_FILTERS.has(key) && c.values.length) qs.set(key, c.values[0]); // 単一値（backend は単一）
  }
  qs.set("page", String(state.page));
  qs.set("per_page", String(state.perPage));
  return qs;
}

export function fetchAiJobs(state: QueryState, signal?: AbortSignal): Promise<AiJobListResult | null> {
  return apiFetch<AiJobListResult>(`/ai-jobs?${aiJobsListParams(state).toString()}`, { signal });
}

export function fetchAiJobsSummary(signal?: AbortSignal): Promise<AiJobSummary | null> {
  return apiFetch<AiJobSummary>("/ai-jobs/summary", { signal });
}

export function getAiJob(id: string, signal?: AbortSignal): Promise<AiJobDetail | null> {
  return apiFetch<AiJobDetail>(`/ai-jobs/${id}`, { signal });
}

// キャンセル（queued は即 canceled／running は協調キャンセル・S.4）。
export function cancelAiJob(id: string): Promise<unknown> {
  return apiFetch(`/ai-jobs/${id}/cancel`, { method: "POST" });
}
