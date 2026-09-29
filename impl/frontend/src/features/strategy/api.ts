// 経営資料（ドメイン R・FR-44）のデータ源＝backend `tenant/strategy`（API R.1）へ実結線。
// 一覧はサーバー委譲（GET /strategy-documents・DataTable §1.8.1）。跨ルート更新は STRATEGY_CHANGED_EVENT を購読。
import type { QueryState } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

import type { QuestLinkItem, StrategyDocDetail, StrategyDocInput, StrategyDocSelectionItem, StrategyListResult } from "./types";

export const STRATEGY_CHANGED_EVENT = "strategy-documents-changed";

export function emitStrategyChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STRATEGY_CHANGED_EVENT));
}

// ソート可能キー＝backend ホワイトリストに一致（updated_at 既定／title/doc_kind/status/period_from/created_at）。
const SORTABLE = new Set(["updated_at", "created_at", "title", "doc_kind", "status", "period_from"]);
const ENUM_FILTERS = new Set(["doc_kind", "status"]);

export function strategyListParams(state: QueryState): URLSearchParams {
  const qs = new URLSearchParams();
  const q = state.search.trim();
  if (q) qs.set("q", q);
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

export function fetchStrategyDocs(state: QueryState, signal?: AbortSignal): Promise<StrategyListResult | null> {
  return apiFetch<StrategyListResult>(`/strategy-documents?${strategyListParams(state).toString()}`, { signal });
}

// 選択用 軽量一覧（クエスト作成フォームの「適用する経営資料」候補・active のみ・R.0）。
export async function fetchStrategySelection(q?: string, signal?: AbortSignal): Promise<StrategyDocSelectionItem[]> {
  const qs = new URLSearchParams({ for: "selection" });
  if (q) qs.set("q", q);
  const res = await apiFetch<{ data: StrategyDocSelectionItem[] }>(`/strategy-documents?${qs.toString()}`, { signal });
  return res?.data ?? [];
}

export function getStrategyDoc(id: string, signal?: AbortSignal): Promise<StrategyDocDetail | null> {
  return apiFetch<StrategyDocDetail>(`/strategy-documents/${id}`, { signal });
}

export function createStrategyDoc(input: StrategyDocInput): Promise<StrategyDocDetail | null> {
  return apiFetch<StrategyDocDetail>("/strategy-documents", { method: "POST", body: JSON.stringify(input) });
}

export function updateStrategyDoc(id: string, input: StrategyDocInput): Promise<StrategyDocDetail | null> {
  return apiFetch<StrategyDocDetail>(`/strategy-documents/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function archiveStrategyDoc(id: string): Promise<StrategyDocDetail | null> {
  return apiFetch<StrategyDocDetail>(`/strategy-documents/${id}/archive`, { method: "POST" });
}

// 復元（アーカイブ解除）。物理削除は設けない（基本は論理削除＝アーカイブ・R.1）。
export function unarchiveStrategyDoc(id: string): Promise<StrategyDocDetail | null> {
  return apiFetch<StrategyDocDetail>(`/strategy-documents/${id}/unarchive`, { method: "POST" });
}

// ---- 紐づくクエスト（R.1b・§5.56） ----
export async function fetchStrategyQuests(id: string, signal?: AbortSignal): Promise<QuestLinkItem[]> {
  const res = await apiFetch<{ data: QuestLinkItem[] }>(`/strategy-documents/${id}/quests`, { signal });
  return res?.data ?? [];
}

export async function fetchQuestCandidates(q?: string, signal?: AbortSignal): Promise<QuestLinkItem[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await apiFetch<{ data: QuestLinkItem[] }>(`/strategy-documents/quest-candidates${qs}`, { signal });
  return res?.data ?? [];
}

export async function addStrategyQuests(id: string, questIds: string[]): Promise<QuestLinkItem[]> {
  const res = await apiFetch<{ data: QuestLinkItem[] }>(`/strategy-documents/${id}/quests`, {
    method: "POST", body: JSON.stringify({ quest_ids: questIds }),
  });
  return res?.data ?? [];
}

export async function removeStrategyQuest(id: string, questId: string): Promise<QuestLinkItem[]> {
  const res = await apiFetch<{ data: QuestLinkItem[] }>(`/strategy-documents/${id}/quests/${questId}`, { method: "DELETE" });
  return res?.data ?? [];
}
