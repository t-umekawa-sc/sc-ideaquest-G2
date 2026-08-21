// quests 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/C_クエスト・パーティー・権限.md C.1/C.4。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type QuestCard = components["schemas"]["QuestCardDTO"];
export type QuestListResponse = components["schemas"]["QuestListResponse"];
export type QuestGroup = components["schemas"]["QuestGroupDTO"];
export type QuestGroupsResponse = components["schemas"]["QuestGroupsResponse"];

// 参加中クエスト＋自分の下書き一覧（SC-10・C.1・FR-15）。参照制限はサーバー強制。
// 本スライスはクライアント DataTable（モック整合）に載せるため limit を大きめに1ページ取得
// （カーソル「もっと見る」は SC-10 §9 TBD＝上限超過時のページングは後続）。
export function listQuests(params?: {
  q?: string;
  status?: string[];
  group_id?: string;
  limit?: number;
  cursor?: string;
}): Promise<QuestListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  for (const s of params?.status ?? []) qs.append("status", s);
  if (params?.group_id) qs.set("group_id", params.group_id);
  qs.set("limit", String(params?.limit ?? 100));
  if (params?.cursor) qs.set("cursor", params.cursor);
  return apiFetch<QuestListResponse>(`/quests?${qs.toString()}`);
}

// 自分が有効所属するクエストグループ一覧（SC-10 フィルタ・SC-11 グループ選択・C.4）。
export function listQuestGroups(q?: string): Promise<QuestGroupsResponse | null> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<QuestGroupsResponse>(`/quest-groups${suffix}`);
}
