// spells 機能の API 呼び出し（§4.1・lib/api 経由）。正＝ドメイン G（魔法カタログ/解放）・SC-32／E.4 前提。
// backend＝GET /spells（カタログ＋unlocked/can_unlock＋SP残高）・POST /spells/{id}/unlock（SP消費・前提/二重解放ガード）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type SpellCatalog = components["schemas"]["SpellCatalogResponse"];
export type SpellDTO = components["schemas"]["SpellDTO"];

// 魔法カタログ＋解放状態＋SP 残高（SC-32・E.4 ピッカー）。
export function getSpells(): Promise<SpellCatalog | null> {
  return apiFetch<SpellCatalog>(`/spells`);
}

// 魔法を解放（SC-32・SP 消費）。前提/SP充足/二重解放はサーバー強制（409）。
export function unlockSpell(spellId: string): Promise<{ spell_id: string; unlocked: boolean; skill_point_balance: number } | null> {
  return apiFetch<{ spell_id: string; unlocked: boolean; skill_point_balance: number }>(`/spells/${spellId}/unlock`, { method: "POST" });
}
