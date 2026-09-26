// quests 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/C_クエスト・パーティー・権限.md C.1〜C.4/C.9。
import { apiFetch, idempotencyHeader } from "@/lib/api/client";
import type { QueryState } from "@/components/ui";
import type { components } from "@/lib/api/schema";

export type QuestCard = components["schemas"]["QuestCardDTO"];
export type QuestCatalogCard = components["schemas"]["QuestCatalogCardDTO"];
export type QuestCatalogDetail = components["schemas"]["QuestCatalogDetailDTO"];
export type QuestCatalogResponse = components["schemas"]["QuestCatalogResponse"];

// 発見カタログ（SC-13・C.9）＝DataTable サーバー契約（§1.8.1・list_query・番号ページャ）。
// ソート可能キー＝backend ホワイトリスト（-created_at〔既定〕/deadline/-member_count）に一致。
const CATALOG_SORTABLE = new Set(["created_at", "deadline", "member_count"]);

export function catalogQueryParams(state: QueryState): URLSearchParams {
  const qs = new URLSearchParams();
  const q = state.search.trim();
  if (q) qs.set("q", q);
  const sort = state.sort
    .filter((s) => CATALOG_SORTABLE.has(s.key))
    .map((s) => (s.dir === "desc" ? `-${s.key}` : s.key));
  if (sort.length) qs.set("sort", sort.join(","));
  for (const key of Object.keys(state.filters)) {
    const c = state.filters[key];
    if (c.type === "enum") {
      if (c.values.length) qs.set(key, c.values.join(",")); // category（UGC 多値）
    } else if (c.type === "text") {
      const t = c.q.trim();
      if (t && !qs.has("q")) qs.set("q", t);
    }
  }
  qs.set("page", String(state.page));
  qs.set("per_page", String(state.perPage));
  return qs;
}

export function fetchQuestCatalog(state: QueryState, signal?: AbortSignal): Promise<QuestCatalogResponse | null> {
  return apiFetch<QuestCatalogResponse>(`/quest-catalog?${catalogQueryParams(state).toString()}`, { signal });
}

export function getCatalogDetail(questId: string): Promise<QuestCatalogDetail | null> {
  return apiFetch<QuestCatalogDetail>(`/quests/${questId}/catalog-detail`);
}

export function followQuest(questId: string): Promise<{ following: boolean } | null> {
  return apiFetch<{ following: boolean }>(`/quests/${questId}/follow`, { method: "POST" });
}
export function unfollowQuest(questId: string): Promise<{ following: boolean } | null> {
  return apiFetch<{ following: boolean }>(`/quests/${questId}/follow`, { method: "DELETE" });
}
export function requestJoinQuest(questId: string, message?: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/quests/${questId}/join-request`, {
    method: "POST", headers: idempotencyHeader(), body: JSON.stringify({ message: message ?? null }),
  });
}
export function withdrawJoinQuest(questId: string): Promise<null> {
  return apiFetch<null>(`/quests/${questId}/join-request`, { method: "DELETE" }) as Promise<null>;
}

// 参加リクエスト 受信側（SC-12 パーティータブ・C.9.1・owner/quest_admin のみ）。
export type JoinRequestRow = components["schemas"]["JoinRequestRowDTO"];
export type JoinRequestListResponse = components["schemas"]["JoinRequestListResponse"];

// 参加リクエスト一覧（既定 pending+rejected）。status で絞り込み可（pending/rejected）。
export function listJoinRequests(questId: string, status?: string[]): Promise<JoinRequestListResponse | null> {
  const qs = new URLSearchParams();
  for (const s of status ?? []) qs.append("status", s);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<JoinRequestListResponse>(`/quests/${questId}/join-requests${suffix}`);
}
// 承認＝member 追加（既定権限）。冪等は Idempotency-Key。
export function approveJoinRequest(questId: string, userId: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/quests/${questId}/join-requests/${userId}/approve`, {
    method: "POST", headers: idempotencyHeader(),
  });
}
// 却下（非終端＝後日 approve で復活可）。
export function rejectJoinRequest(questId: string, userId: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/quests/${questId}/join-requests/${userId}/reject`, { method: "POST" });
}

// 申請者プロフィール（承認判断材料・C.9.1・owner/quest_admin のみ）。ゲーム層は viewer のゲームモード ON 時のみ。
export type JoinRequestProfile = components["schemas"]["JoinRequestProfileDTO"];
export function getJoinRequestProfile(questId: string, userId: string): Promise<JoinRequestProfile | null> {
  return apiFetch<JoinRequestProfile>(`/quests/${questId}/join-requests/${userId}/profile`);
}

export type QuestListResponse = components["schemas"]["QuestListResponse"];
export type QuestGroup = components["schemas"]["QuestGroupDTO"];
export type QuestGroupsResponse = components["schemas"]["QuestGroupsResponse"];
export type QuestDetail = components["schemas"]["QuestDetailDTO"];
export type QuestMember = components["schemas"]["QuestMemberDTO"];
export type QuestMemberInput = components["schemas"]["QuestMemberInput"];
export type QuestMembersResponse = components["schemas"]["QuestMembersResponse"];
export type QuestCreateInput = components["schemas"]["QuestCreateRequest"];
export type QuestUpdateInput = components["schemas"]["QuestUpdateRequest"];
export type QuestPublishInput = components["schemas"]["QuestPublishRequest"];
export type QuestResult = components["schemas"]["QuestResultDTO"];
export type QuestResultDecision = components["schemas"]["QuestResultDecisionDTO"];
export type QuestOutcome = components["schemas"]["QuestOutcomeDTO"];
export type QuestOutcomeInput = components["schemas"]["QuestOutcomeUpdateRequest"];
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

// 自分が有効所属するクエストグループ一覧（SC-10 フィルタ・SC-11 主グループ選択・C.4）。
export function listQuestGroups(q?: string): Promise<QuestGroupsResponse | null> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<QuestGroupsResponse>(`/quest-groups${suffix}`);
}

// 会社内の全クエストグループ（部署ディレクトリ・SC-11 追加グループ選択・FR-38・C.4）。所属に依らず全件。
export function listCompanyGroupDirectory(q?: string): Promise<QuestGroupsResponse | null> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<QuestGroupsResponse>(`/quest-group-directory${suffix}`);
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

// 複数グループ横断のパーティー候補（FR-38・SC-11/SC-12・C.4 GET /quest-group-candidates）。
// group_ids のいずれかに所属する候補を返し、各候補に所属 group_ids（部署バッジ用）が付く。
// exclude_user_ids はサーバー側で除外（既参加/追加中/作成者本人）。
export function listQuestGroupCandidates(
  groupIds: string[],
  params?: { q?: string; exclude_user_ids?: string[]; limit?: number; cursor?: string },
): Promise<QuestCandidatesResponse | null> {
  const qs = new URLSearchParams();
  for (const g of groupIds) qs.append("group_ids", g);
  if (params?.q) qs.set("q", params.q);
  for (const id of params?.exclude_user_ids ?? []) qs.append("exclude_user_ids", id);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.cursor) qs.set("cursor", params.cursor);
  return apiFetch<QuestCandidatesResponse>(`/quest-group-candidates?${qs.toString()}`);
}

// クエスト詳細（SC-12 概要／SC-11 編集プリフィル・C.1）。可視性はサーバー強制（範囲外は 404）。
export function getQuest(questId: string): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}`);
}

// クエスト内の活発度スパーク（SC-12・C.1・メンバー可視）＝日次メッセージ数（公開アイデア横断）。
export type QuestActivity = components["schemas"]["QuestActivityDTO"];
export function getQuestActivity(questId: string): Promise<QuestActivity | null> {
  return apiFetch<QuestActivity>(`/quests/${questId}/activity`);
}

// クエスト作成（SC-11・C.2）。作成者＝所有者。status=recruiting は即公開（strict 検証＋参加通知）。
export function createQuest(input: QuestCreateInput): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>("/quests", { method: "POST", body: JSON.stringify(input), headers: idempotencyHeader() });
}

// クエスト編集（SC-11・C.2）。差分＝送るフィールドのみ。status は変えない（遷移は publish/transition）。
export function updateQuest(questId: string, input: QuestUpdateInput): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// パーティー（参加メンバー＋権限）だけを一括更新（C.3 PUT /quests/{id}/party・あるべき全体像で差分適用）。
// SC-12「パーティー・権限を編集」＝URL モーダルから members のみ送る（参加グループ等の内容は触らない）。owner/quest_admin。
export function updateParty(questId: string, members: QuestMemberInput[]): Promise<QuestMembersResponse | null> {
  return apiFetch<QuestMembersResponse>(`/quests/${questId}/party`, { method: "PUT", body: JSON.stringify({ members }) });
}

// クエスト最終結果＝アイデア選別の申し送り（FR-39・SC-12 結果タブ・完了時）。既存集計の合成＋総括を取得。
export function getQuestResult(questId: string): Promise<QuestResult | null> {
  return apiFetch<QuestResult>(`/quests/${questId}/result`);
}
// 総括（振り返り/次アクション/KPI）の保存（FR-39・owner/quest_admin・送った項目のみ更新）。
export function updateQuestResult(questId: string, input: QuestOutcomeInput): Promise<QuestOutcome | null> {
  return apiFetch<QuestOutcome>(`/quests/${questId}/result`, { method: "PUT", body: JSON.stringify(input) });
}
// (c) 議論の要点＝チャットの自動要約（抽出型・オフライン・無料）を生成/再生成（FR-39・owner/quest_admin）。
export function generateChatSummary(questId: string): Promise<QuestOutcome | null> {
  return apiFetch<QuestOutcome>(`/quests/${questId}/result/chat-summary`, { method: "POST" });
}
// 振り返り（総括）の版差分（変更履歴標準 §3.1・折り畳みUI の展開時に取得）。
export type QuestOutcomeRevisionDiff = components["schemas"]["QuestOutcomeRevisionDiffResponse"];
export function getQuestOutcomeRevisionDiff(questId: string, revision: number): Promise<QuestOutcomeRevisionDiff | null> {
  return apiFetch<QuestOutcomeRevisionDiff>(`/quests/${questId}/result/revisions/${revision}/diff`);
}

// 下書きを公開（draft→recruiting・C.2・アトミック）。owner のみ・strict 検証。
export function publishQuest(questId: string, input: QuestPublishInput): Promise<QuestDetail | null> {
  return apiFetch<QuestDetail>(`/quests/${questId}/publish`, { method: "POST", body: JSON.stringify(input), headers: idempotencyHeader() });
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
