// quests 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/C_クエスト・パーティー・権限.md C.1〜C.4。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type QuestCard = components["schemas"]["QuestCardDTO"];
export type QuestListResponse = components["schemas"]["QuestListResponse"];
export type QuestGroup = components["schemas"]["QuestGroupDTO"];
export type QuestGroupsResponse = components["schemas"]["QuestGroupsResponse"];
export type QuestDetail = components["schemas"]["QuestDetailDTO"];
export type QuestMember = components["schemas"]["QuestMemberDTO"];
export type QuestMemberInput = components["schemas"]["QuestMemberInput"];
export type QuestCreateInput = components["schemas"]["QuestCreateRequest"];
export type QuestUpdateInput = components["schemas"]["QuestUpdateRequest"];
export type QuestPublishInput = components["schemas"]["QuestPublishRequest"];
export type QuestCandidate = components["schemas"]["QuestCandidateDTO"];
export type QuestCandidatesResponse = components["schemas"]["QuestCandidatesResponse"];
export type QuestIconImageResponse = components["schemas"]["QuestIconImageResponse"];

// クエストの変更（作成/公開など）通知イベント名。URL モーダル（別ルート）からの成功時に window へ発火し、
// 一覧（QuestListView）が購読して再取得する（跨ルートの疎結合ブリッジ・会社一覧 COMPANIES_CHANGED と同方式）。
export const QUESTS_CHANGED_EVENT = "ideaquest:quests-changed";

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

// パーティー候補＝同一グループの有効メンバー（SC-11・C.4）。exclude_user_ids はサーバー側で除外
// （既にパーティー内/追加中/作成者本人＝ページングと整合）。
export function listGroupMemberCandidates(
  groupId: string,
  params?: { q?: string; exclude_user_ids?: string[]; limit?: number; cursor?: string },
): Promise<QuestCandidatesResponse | null> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  for (const id of params?.exclude_user_ids ?? []) qs.append("exclude_user_ids", id);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<QuestCandidatesResponse>(`/quest-groups/${groupId}/members${suffix}`);
}

// クエスト詳細（SC-12 概要／SC-11 編集プリフィル・C.1）。可視性はサーバー強制（範囲外は 404）。
export function getQuest(questId: string): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}`);
}

// クエスト作成（SC-11・C.2）。作成者＝所有者。status=recruiting は即公開（strict 検証＋参加通知）。
export function createQuest(input: QuestCreateInput): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>("/quests", { method: "POST", body: JSON.stringify(input) });
}

// クエスト編集（SC-11・C.2）。差分＝送るフィールドのみ。status は変えない（遷移は publish/transition）。
export function updateQuest(questId: string, input: QuestUpdateInput): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// 下書きを公開（draft→recruiting・C.2・アトミック）。owner のみ・strict 検証。
export function publishQuest(questId: string, input: QuestPublishInput): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}/publish`, { method: "POST", body: JSON.stringify(input) });
}

// ステータスを前進（SC-12・C.5・owner/quest_admin）。逆行/飛び越えは 409、draft→recruiting は strict。
export function transitionQuest(questId: string, input: { to: string }): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}/transition`, { method: "POST", body: JSON.stringify(input) });
}

// クエストを論理削除（SC-12・C.2・owner/quest_admin）。子データは監査保持。
export function deleteQuest(questId: string): Promise<null> {
  return apiFetch<null>(`/quests/${questId}`, { method: "DELETE" }) as Promise<null>;
}

// クエストアイコン設定/削除（SC-11・論点2・multipart・K.4 流儀）。CSRF/Content-Type は apiFetch/ブラウザが処理。
export function setQuestIcon(questId: string, file: File): Promise<QuestIconImageResponse | null> {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch<QuestIconImageResponse>(`/quests/${questId}/icon-image`, { method: "PUT", body: fd });
}
export function deleteQuestIcon(questId: string): Promise<null> {
  return apiFetch<null>(`/quests/${questId}/icon-image`, { method: "DELETE" }) as Promise<null>;
}
