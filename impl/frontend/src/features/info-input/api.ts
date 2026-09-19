// 情報インプットのデータ源 seam（フロント実装フロー規約 §4）。
// 現状＝インメモリ（fixtures 由来）でクリッカブル・プロトタイプを成立させる。跨ルート更新は INFO_CHANGED_EVENT を購読。
// backend `tenant/info`（API ドメイン N）実装後、本ファイルの実装だけを実 API 呼び出しへ差し替える（呼び出し側は不変）。
import { INFO_FIXTURES } from "./fixtures";
import type { InfoItem, InfoLink } from "./types";

export const INFO_CHANGED_EVENT = "info-items-changed";

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
    due_date: null,
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
    triage_reason: input.triage_reason ?? null, links: (input.links ?? item.links).map((l) => clone(l)),
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
