// 情報インプットのデータ源 seam（フロント実装フロー規約 §4）。
// 現状＝インメモリ（fixtures 由来）でクリッカブル・プロトタイプを成立させる。跨ルート更新は INFO_CHANGED_EVENT を購読。
// backend `tenant/info`（API ドメイン N）実装後、本ファイルの実装だけを実 API 呼び出しへ差し替える（呼び出し側は不変）。
import { apiFetch } from "@/lib/api/client";
import type { QueryState } from "@/components/ui";
import { INFO_FIXTURES } from "./fixtures";
import type { InfoCard, InfoDetail, InfoItem, InfoLink, InfoListResult, InfoStatusFilter, WordCloudToken } from "./types";

export const INFO_CHANGED_EVENT = "info-items-changed";

// --- 一覧＝サーバー委譲（GET /info-items・DataTable §1.8.1・番号ページャ）。 ---
// ソート可能キー＝backend ホワイトリスト（created_at〔既定 -created_at〕/title/status/priority/due_date/link_count）に一致。
const INFO_SORTABLE = new Set(["created_at", "title", "status", "priority", "due_date", "link_count"]);
// 列フィルタ（enum）＝backend が受けるキーのみ（status はタブが担うので列フィルタからは除外）。
const INFO_ENUM_FILTERS = new Set(["priority", "source", "impact_class"]);

export interface InfoListExtra {
  status?: InfoStatusFilter; // 状態タブ（all/raw/curated）＝server の status フィルタ
  rootsOnly?: boolean; // 続報を束ねる＝roots_only
}

export function infoListParams(state: QueryState, extra: InfoListExtra = {}): URLSearchParams {
  const qs = new URLSearchParams();
  const q = state.search.trim();
  if (q) qs.set("q", q); // 横断検索＝全文（title＋body_text・PGroonga）
  const sort = state.sort
    .filter((s) => INFO_SORTABLE.has(s.key))
    .map((s) => (s.dir === "desc" ? `-${s.key}` : s.key));
  if (sort.length) qs.set("sort", sort.join(","));
  for (const key of Object.keys(state.filters)) {
    const c = state.filters[key];
    if (c.type === "enum" && INFO_ENUM_FILTERS.has(key) && c.values.length) qs.set(key, c.values.join(","));
  }
  if (extra.status && extra.status !== "all") qs.set("status", extra.status);
  if (extra.rootsOnly) qs.set("roots_only", "true");
  qs.set("page", String(state.page));
  qs.set("per_page", String(state.perPage));
  return qs;
}

export function fetchInfoItems(
  state: QueryState, extra: InfoListExtra = {}, signal?: AbortSignal,
): Promise<InfoListResult | null> {
  return apiFetch<InfoListResult>(`/info-items?${infoListParams(state, extra).toString()}`, { signal });
}

// 全文検索タブ（🔍）＝server q（title＋body_text）。上位 50 件を取得（表示は title＋要約スニペット）。
export async function searchInfoItems(q: string, signal?: AbortSignal): Promise<InfoCard[]> {
  const qs = new URLSearchParams({ q, per_page: "50", page: "1", sort: "-created_at" });
  const res = await apiFetch<InfoListResult>(`/info-items?${qs.toString()}`, { signal });
  return res?.data ?? [];
}

export async function fetchWordCloud(limit = 40, signal?: AbortSignal): Promise<WordCloudToken[]> {
  const res = await apiFetch<{ tokens: WordCloudToken[] }>(`/info-items/word-cloud?limit=${limit}`, { signal });
  return res?.tokens ?? [];
}

// 詳細（GET /info-items/{id}）＝全属性＋links〔target_title 解決〕＋thread＋tokens_top＋can（Phase B）。
export function fetchInfoDetail(id: string, signal?: AbortSignal): Promise<InfoDetail | null> {
  return apiFetch<InfoDetail>(`/info-items/${encodeURIComponent(id)}`, { signal });
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let store: InfoItem[] = INFO_FIXTURES.map((x) => clone(x));
let seq = 100;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INFO_CHANGED_EVENT));
}

// 一覧（GET /info-items）。当面は全件返却＝一覧側でクライアント絞込（将来はサーバー委譲＝§4.1）。
export async function listInfoItems(): Promise<InfoItem[]> {
  return store.map((x) => clone(x));
}

export function getInfoItem(id: string): InfoItem | undefined {
  const found = store.find((x) => x.id === id);
  return found ? clone(found) : undefined;
}

export function followUps(id: string): InfoItem[] {
  return store.filter((x) => x.parent_info_id === id).map((x) => clone(x));
}

export function rootOf(item: InfoItem): InfoItem {
  let cur = item;
  while (cur.parent_info_id) {
    const p = store.find((x) => x.id === cur.parent_info_id);
    if (!p) break;
    cur = p;
  }
  return clone(cur);
}

export interface InfoInput {
  title: string;
  body_html: string;
  summary?: string;
  source_url?: string | null;
  parent_info_id?: string | null;
  priority?: string | null;
  source?: string | null;
  classification?: string | null;
  scope?: string | null;
  target_business?: string | null;
  categories?: string[];
  impact_level?: string | null;
  impact_class?: string | null;
  impact_timing?: string | null;
  triaged_on?: string | null;
  triage?: string | null;
  triage_reason?: string | null;
  due_date?: string | null;
  links?: InfoLink[];
}

// curated 属性が付いたら raw→curated（デモ）。実装はサーバー再検証（§N.2）。
function isCurated(input: InfoInput): boolean {
  return Boolean(input.priority || input.impact_class || input.triage || (input.categories && input.categories.length));
}

export function createInfoItem(input: InfoInput): InfoItem {
  const id = "i" + ++seq;
  const item: InfoItem = {
    id,
    parent_info_id: input.parent_info_id ?? null,
    title: input.title,
    body_html: input.body_html,
    summary: input.summary ?? "",
    source_url: input.source_url ?? "",
    due_date: input.due_date ?? null,
    status: isCurated(input) ? "curated" : "raw",
    priority: input.priority ?? null,
    source: input.source ?? null,
    classification: input.classification ?? null,
    scope: input.scope ?? null,
    target_business: input.target_business ?? null,
    categories: input.categories ?? [],
    impact_level: input.impact_level ?? null,
    impact_class: input.impact_class ?? null,
    impact_timing: input.impact_timing ?? null,
    triaged_on: input.triaged_on ?? null,
    triage: input.triage ?? null,
    triage_reason: input.triage_reason ?? null,
    created_by: "情報 花子",
    created_at: "今日",
    links: (input.links ?? []).map((l) => clone(l)),
  };
  store.push(item);
  emit();
  return clone(item);
}

export function updateInfoItem(id: string, input: InfoInput): InfoItem | undefined {
  const item = store.find((x) => x.id === id);
  if (!item) return undefined;
  Object.assign(item, {
    title: input.title, body_html: input.body_html, summary: input.summary ?? item.summary,
    source_url: input.source_url ?? "", priority: input.priority ?? null, source: input.source ?? null,
    classification: input.classification ?? null, scope: input.scope ?? null, target_business: input.target_business ?? null,
    categories: input.categories ?? [], impact_level: input.impact_level ?? null, impact_class: input.impact_class ?? null,
    impact_timing: input.impact_timing ?? null, triaged_on: input.triaged_on ?? null, triage: input.triage ?? null,
    triage_reason: input.triage_reason ?? null, due_date: input.due_date ?? null, links: (input.links ?? item.links).map((l) => clone(l)),
    status: isCurated(input) ? "curated" : item.status,
  });
  emit();
  return clone(item);
}

export function archiveInfoItem(id: string) {
  const item = store.find((x) => x.id === id);
  if (item) { item.status = "archived"; emit(); }
}

export function deleteInfoItem(id: string) {
  store = store.filter((x) => x.id !== id);
  emit();
}

// クエスト作成の動線（この情報→クエスト）。デモ＝当該情報に info_link（関連・manual）を追加（本番は API C from_info_id）。
export function linkQuestFromInfo(infoId: string, questTitle: string) {
  const item = store.find((x) => x.id === infoId);
  if (item) { item.links.push({ target_type: "quests", target_title: questTitle, kind: "related", origin: "manual", score: null }); emit(); }
}
