// shop 機能の API 呼び出し（§4.1・lib/api 経由）。正＝ドメイン G.1/G.2（ショップ/装備）・SC-30/SC-31。
// backend＝GET /items（マスタ＋所有/装備＋残高）・POST /items/{id}/purchase・GET /me/items・PUT /me/equipment。
// アイテムのアイコン（絵文字）はフロント presentation（§5.25/API G.1 に icon 列なし＝code で引く）。
import { apiFetch, idempotencyHeader } from "@/lib/api/client";
import type { QueryState } from "@/components/ui";
import type { components } from "@/lib/api/schema";

export type ItemDTO = components["schemas"]["ItemDTO"];
export type ItemListResponse = components["schemas"]["ItemListResponse"];
export type MyItemsResponse = components["schemas"]["MyItemsResponse"];
export type EquipmentRequest = components["schemas"]["EquipmentRequest"];

// DataTable サーバー契約（§1.8.1）のソート可能キー＝backend ホワイトリスト（G.1）に一致させる。
const ITEM_SORTABLE_KEYS = new Set(["name", "slot", "rarity", "price"]);

// QueryState → GET /items のクエリ（companies と同じ generic 変換＝enum 多値カンマ／number _min/_max／text→q）。
// 「状態」列（key=state）の enum 多値（owned/affordable/short）は backend の `state` へそのまま載る（§1.8.1②）。
export function itemsQueryParams(state: QueryState): URLSearchParams {
  const qs = new URLSearchParams();
  const q = state.search.trim();
  if (q) qs.set("q", q);
  const sort = state.sort
    .filter((s) => ITEM_SORTABLE_KEYS.has(s.key))
    .map((s) => (s.dir === "desc" ? `-${s.key}` : s.key));
  if (sort.length) qs.set("sort", sort.join(","));
  for (const key of Object.keys(state.filters)) {
    const c = state.filters[key];
    if (c.type === "enum") {
      if (c.values.length) qs.set(key, c.values.join(","));  // slot/rarity/state（多値）
    } else if (c.type === "number") {
      if (c.min != null) qs.set(`${key}_min`, String(c.min));  // price_min/price_max
      if (c.max != null) qs.set(`${key}_max`, String(c.max));
    } else if (c.type === "text") {
      const t = c.q.trim();
      if (t && !qs.has("q")) qs.set("q", t);  // name の text フィルタは横断 q に載せる
    }
  }
  const pins = state.pinIds.filter(Boolean).slice(0, 5);
  if (pins.length) qs.set("pin_ids", pins.join(","));
  qs.set("page", String(state.page));
  qs.set("per_page", String(state.perPage));
  return qs;
}

export function fetchItemsPage(state: QueryState, signal?: AbortSignal): Promise<ItemListResponse | null> {
  return apiFetch<ItemListResponse>(`/items?${itemsQueryParams(state).toString()}`, { signal });
}

// CSV エクスポート（同一絞込/ソートの全件・§1.8.1③）＝ページングを外し format=csv／columns を付ける。
export function itemsCsvUrl(state: QueryState, columns: string[]): string {
  const qs = itemsQueryParams(state);
  qs.delete("page");
  qs.delete("per_page");
  qs.set("format", "csv");
  if (columns.length) qs.set("columns", columns.join(","));
  return `/api/v1/items?${qs.toString()}`;
}

// code→絵文字（presentation・シードの code と一致）。未知は ❔。
export const ITEM_ICON: Record<string, string> = {
  crown: "👑", tophat: "🎩", cap: "🧢", straw: "👒",
  shades: "🕶️", glasses: "👓", mask: "😷",
  armor: "🛡️", suit: "👔", coat: "🧥", gi: "🥋",
  sword: "⚔️", wand: "🪄", hammer: "🔨", book: "📖",
  castle: "🏰", galaxy: "🌌", sunset: "🌅", forest: "🌲",
};

export function getItems(): Promise<ItemListResponse | null> {
  return apiFetch<ItemListResponse>(`/items`);
}

export function purchaseItem(itemId: string): Promise<{ item_id: string; owned: boolean; coin_balance: number } | null> {
  // 冪等キー付き（§1.9）＝二重送信でもコインは一度しか消費されない（サーバーが最初の結果を再生）。
  return apiFetch<{ item_id: string; owned: boolean; coin_balance: number }>(`/items/${itemId}/purchase`, { method: "POST", headers: idempotencyHeader() });
}

export function getMyItems(): Promise<MyItemsResponse | null> {
  return apiFetch<MyItemsResponse>(`/me/items`);
}

// 装備更新（部分マップ・slot→item_id|null）。各スロット1点はサーバー強制。
export function updateEquipment(equipment: Record<string, string | null>): Promise<{ equipped: Record<string, string | null> } | null> {
  return apiFetch<{ equipped: Record<string, string | null> }>(`/me/equipment`, { method: "PUT", body: JSON.stringify(equipment) });
}
