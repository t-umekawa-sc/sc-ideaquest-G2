// chat 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/E_チャット・リアクション・魔法発動.md E.1〜E.5・G（魔法解放）。
// backend＝GET chat（一覧＋未読）・GET chat-activity・POST/PATCH/DELETE chat-messages（multipart）・POST chat/read
// ・POST/DELETE chat-messages/{id}/reactions（通常/魔法）／G＝GET /spells・POST /spells/{id}/unlock。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ChatMessage = components["schemas"]["ChatMessageDTO"];
export type ChatListResponse = components["schemas"]["ChatListResponse"];
export type ChatActivity = components["schemas"]["ChatActivityResponse"];
export type ChatReactionsResponse = components["schemas"]["ChatReactionsResponse"];
export type SpellCatalog = components["schemas"]["SpellCatalogResponse"];
export type Spell = components["schemas"]["SpellDTO"];

// メッセージ一覧＋未読（SC-24・E.1）。門番はサーバー強制（範囲外 404）。
export function getChat(ideaId: string, params?: { limit?: number; before?: string; after?: string }): Promise<ChatListResponse | null> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params?.limit ?? 50));
  if (params?.before) qs.set("before", params.before);
  if (params?.after) qs.set("after", params.after);
  return apiFetch<ChatListResponse>(`/ideas/${ideaId}/chat?${qs.toString()}`);
}

// 議論アクティビティ集計（SC-22 §4.4・E.1）。
export function getChatActivity(ideaId: string, days = 14): Promise<ChatActivity | null> {
  return apiFetch<ChatActivity>(`/ideas/${ideaId}/chat-activity?days=${days}`);
}

// メッセージ投稿（E.2・multipart）。body/mentions/引用（複数可）/files を単一 UoW。空は 422・投稿 XP+5。
export function postMessage(
  ideaId: string,
  input: { body?: string; quotedMessageIds?: string[]; mentions?: string[]; files?: File[] },
): Promise<ChatMessage | null> {
  const fd = new FormData();
  fd.append("idea_id", ideaId);
  if (input.body) fd.append("body", input.body);
  for (const q of input.quotedMessageIds ?? []) fd.append("quoted_message_ids", q);
  for (const m of input.mentions ?? []) fd.append("mentions", m);
  for (const f of input.files ?? []) fd.append("files", f);
  return apiFetch<ChatMessage>(`/chat-messages`, { method: "POST", body: fd });
}

// メッセージ編集（E.2・本人のみ・multipart）。body/mentions 置換・files 追加・remove_attachment_ids 除去。
export function editMessage(
  messageId: string,
  input: { body?: string; mentions?: string[]; files?: File[]; removeAttachmentIds?: string[] },
): Promise<ChatMessage | null> {
  const fd = new FormData();
  if (input.body !== undefined) fd.append("body", input.body);
  for (const m of input.mentions ?? []) fd.append("mentions", m);
  for (const f of input.files ?? []) fd.append("files", f);
  for (const id of input.removeAttachmentIds ?? []) fd.append("remove_attachment_ids", id);
  return apiFetch<ChatMessage>(`/chat-messages/${messageId}`, { method: "PATCH", body: fd });
}

// メッセージ論理削除（E.2・本人＋owner/quest_admin）。
export function deleteMessage(messageId: string): Promise<{ id: string; is_deleted: boolean } | null> {
  return apiFetch<{ id: string; is_deleted: boolean }>(`/chat-messages/${messageId}`, { method: "DELETE" }) as Promise<{ id: string; is_deleted: boolean } | null>;
}

// 既読位置更新（E.5・後退防止）。完了後も許可。
export function markRead(ideaId: string, lastReadMessageId: string): Promise<{ unread_count: number } | null> {
  return apiFetch<{ unread_count: number }>(`/ideas/${ideaId}/chat/read`, { method: "POST", body: JSON.stringify({ last_read_message_id: lastReadMessageId }) });
}

// リアクション付与（通常＝emoji／魔法＝spell_id・E.4）。更新後の集計を返す。
export function addReaction(messageId: string, input: { type: "normal" | "magic"; emoji?: string; spell_id?: string }): Promise<ChatReactionsResponse | null> {
  return apiFetch<ChatReactionsResponse>(`/chat-messages/${messageId}/reactions`, { method: "POST", body: JSON.stringify(input) });
}

// リアクション取消（通常＝emoji／魔法＝type=magic・E.4）。自分の分のみ。
export function removeReaction(messageId: string, params: { emoji?: string; magic?: boolean }): Promise<ChatReactionsResponse | null> {
  const qs = new URLSearchParams();
  if (params.emoji) qs.set("emoji", params.emoji);
  if (params.magic) qs.set("type", "magic");
  return apiFetch<ChatReactionsResponse>(`/chat-messages/${messageId}/reactions?${qs.toString()}`, { method: "DELETE" });
}

// 魔法カタログ＋解放状態（SC-32・E.4 ピッカー）。
export function getSpells(): Promise<SpellCatalog | null> {
  return apiFetch<SpellCatalog>(`/spells`);
}

// 魔法解放（SC-32・SP 消費）。
export function unlockSpell(spellId: string): Promise<{ unlocked: boolean; skill_point_balance: number } | null> {
  return apiFetch<{ unlocked: boolean; skill_point_balance: number }>(`/spells/${spellId}/unlock`, { method: "POST" });
}

// パーティーメンバー（@メンション候補・C.1）。{user_id, display_name} を最小取得。
export function getPartyMembers(questId: string): Promise<{ data: Array<{ user_id: string; display_name: string }> } | null> {
  return apiFetch<{ data: Array<{ user_id: string; display_name: string }> }>(`/quests/${questId}/members`);
}
