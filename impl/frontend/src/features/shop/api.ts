// shop 機能の API 呼び出し（§4.1・lib/api 経由）。正＝ドメイン G.1/G.2（ショップ/装備）・SC-30/SC-31。
// backend＝GET /items（マスタ＋所有/装備＋残高）・POST /items/{id}/purchase・GET /me/items・PUT /me/equipment。
// アイテムのアイコン（絵文字）はフロント presentation（§5.25/API G.1 に icon 列なし＝code で引く）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ItemDTO = components["schemas"]["ItemDTO"];
export type ItemListResponse = components["schemas"]["ItemListResponse"];
export type MyItemsResponse = components["schemas"]["MyItemsResponse"];
export type EquipmentRequest = components["schemas"]["EquipmentRequest"];

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
  return apiFetch<{ item_id: string; owned: boolean; coin_balance: number }>(`/items/${itemId}/purchase`, { method: "POST" });
}

export function getMyItems(): Promise<MyItemsResponse | null> {
  return apiFetch<MyItemsResponse>(`/me/items`);
}

// 装備更新（部分マップ・slot→item_id|null）。各スロット1点はサーバー強制。
export function updateEquipment(equipment: Record<string, string | null>): Promise<{ equipped: Record<string, string | null> } | null> {
  return apiFetch<{ equipped: Record<string, string | null> }>(`/me/equipment`, { method: "PUT", body: JSON.stringify(equipment) });
}
