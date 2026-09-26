// concepts 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/P_コンセプト.md P.1〜P.6・FR-42。
// backend は P.1/P.2（一覧/詳細/作成/編集/遷移/選定/判定）＋P.3/P.4（前提・検証・リンク）＋P.5/P.5b（評価/投票）＋P.6（チャット）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ConceptDetail = components["schemas"]["ConceptDetailDTO"];
export type ConceptListItem = components["schemas"]["ConceptListItemDTO"];
export type ConceptListResponse = components["schemas"]["ConceptListResponse"];
export type ConceptCreateInput = components["schemas"]["ConceptCreateRequest"];
export type ConceptPatchInput = components["schemas"]["ConceptPatchRequest"];
export type ConceptDecisionInput = components["schemas"]["ConceptDecisionRequest"];
export type ConceptVoteResult = components["schemas"]["ConceptVoteResponse"];
export type ConceptAssumption = components["schemas"]["ConceptAssumptionDTO"];
export type ConceptChatScope = components["schemas"]["ConceptChatScopeDTO"];
export type ConceptSourceIdea = components["schemas"]["ConceptSourceIdeaDTO"];
export type ConceptEvalSummary = components["schemas"]["ConceptEvalSummaryDTO"];
export type AssumptionListResponse = components["schemas"]["AssumptionListResponse"];
export type AssumptionDetail = components["schemas"]["AssumptionDetailDTO"];
export type EvaluationAggregate = components["schemas"]["ConceptEvaluationAggregateDTO"];
export type EvaluationMe = components["schemas"]["ConceptEvaluationMeDTO"];
export type EvaluationPutInput = components["schemas"]["ConceptEvaluationPutRequest"];
export type ConceptVoteType = components["schemas"]["ConceptVoteRequest"]["type"];

// コンセプトの変更（作成/編集/遷移/選定/判定）通知イベント名。URL モーダル/別ルートからの成功時に window へ発火し、
// SC-12 コンセプトタブや SC-61 が購読して再取得する（跨ルートの疎結合ブリッジ・IDEAS_CHANGED と同方式）。
export const CONCEPTS_CHANGED_EVENT = "ideaquest:concepts-changed";

// ---- 取得（P.1） ----

export function getConcept(conceptId: string): Promise<ConceptDetail | null> {
  return apiFetch<ConceptDetail>(`/concepts/${conceptId}`);
}

// ---- 変更履歴（内容の版＋意思決定ログ・§3.1/§3.2） ----
export type ConceptRevisionList = components["schemas"]["ConceptRevisionListResponse"];
export type ConceptRevisionDiff = components["schemas"]["ConceptRevisionDiffResponse"];
export type ConceptDecisionLog = components["schemas"]["ConceptDecisionLogResponse"];

export function getConceptRevisions(conceptId: string, params?: { limit?: number; cursor?: string }): Promise<ConceptRevisionList | null> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.cursor) qs.set("cursor", params.cursor);
  const q = qs.toString();
  return apiFetch<ConceptRevisionList>(`/concepts/${conceptId}/revisions${q ? `?${q}` : ""}`);
}

export function getConceptRevisionDiff(conceptId: string, revision: number): Promise<ConceptRevisionDiff | null> {
  return apiFetch<ConceptRevisionDiff>(`/concepts/${conceptId}/revisions/${revision}/diff`);
}

export function getConceptDecisionLog(conceptId: string): Promise<ConceptDecisionLog | null> {
  return apiFetch<ConceptDecisionLog>(`/concepts/${conceptId}/decision-log`);
}

// 自分のコンセプト評価の確定版差分（変更履歴標準 §3.6・折り畳みUI の展開時に取得）。
export type ConceptEvalRevisionDiff = components["schemas"]["ConceptEvalRevisionDiffResponse"];
export function getConceptEvalRevisionDiff(conceptId: string, revision: number): Promise<ConceptEvalRevisionDiff | null> {
  return apiFetch<ConceptEvalRevisionDiff>(`/concepts/${conceptId}/evaluation/revisions/${revision}/diff`);
}

export function listConcepts(questId: string): Promise<ConceptListResponse | null> {
  return apiFetch<ConceptListResponse>(`/quests/${questId}/concepts`);
}

// 前提の作成（P.3・検証プール所有＝owner/quest_admin）。statement のみ。
export function createAssumption(questId: string, statement: string): Promise<AssumptionDetail | null> {
  return apiFetch<AssumptionDetail>(`/quests/${questId}/assumptions`, { method: "POST", body: JSON.stringify({ statement }) });
}

export function listAssumptions(questId: string): Promise<AssumptionListResponse | null> {
  return apiFetch<AssumptionListResponse>(`/quests/${questId}/assumptions`);
}

// ---- 登録・編集・遷移・選定・判定（P.2） ----

export function createConcept(questId: string, body: ConceptCreateInput): Promise<ConceptDetail | null> {
  return apiFetch<ConceptDetail>(`/quests/${questId}/concepts`, { method: "POST", body: JSON.stringify(body) });
}

export function patchConcept(conceptId: string, body: ConceptPatchInput): Promise<ConceptDetail | null> {
  return apiFetch<ConceptDetail>(`/concepts/${conceptId}`, { method: "PATCH", body: JSON.stringify(body) });
}

// 論理削除（P.2・作成者 or owner/quest_admin）。子データは監査保持。
export function deleteConcept(conceptId: string): Promise<null> {
  return apiFetch(`/concepts/${conceptId}`, { method: "DELETE" });
}

export function activateConcept(conceptId: string): Promise<ConceptDetail | null> {
  return apiFetch<ConceptDetail>(`/concepts/${conceptId}/activate`, { method: "POST" });
}

export function archiveConcept(conceptId: string): Promise<ConceptDetail | null> {
  return apiFetch<ConceptDetail>(`/concepts/${conceptId}/archive`, { method: "POST" });
}

export function selectConcept(conceptId: string): Promise<unknown> {
  return apiFetch(`/concepts/${conceptId}/select`, { method: "POST" });
}

export function unselectConcept(conceptId: string): Promise<unknown> {
  return apiFetch(`/concepts/${conceptId}/select`, { method: "DELETE" });
}

export function setDecision(conceptId: string, body: ConceptDecisionInput): Promise<ConceptDetail | null> {
  return apiFetch<ConceptDetail>(`/concepts/${conceptId}/decision`, { method: "PUT", body: JSON.stringify(body) });
}

// ---- 投票（P.5b） ----

export function voteConcept(conceptId: string, type: ConceptVoteType): Promise<ConceptVoteResult | null> {
  return apiFetch<ConceptVoteResult>(`/concepts/${conceptId}/vote`, { method: "POST", body: JSON.stringify({ type }) });
}

export function unvoteConcept(conceptId: string): Promise<ConceptVoteResult | null> {
  return apiFetch<ConceptVoteResult>(`/concepts/${conceptId}/vote`, { method: "DELETE" });
}

// ---- 評価（P.5） ----

export function getEvaluationAggregate(conceptId: string): Promise<EvaluationAggregate | null> {
  return apiFetch<EvaluationAggregate>(`/concepts/${conceptId}/evaluation`);
}

export function getMyEvaluation(conceptId: string): Promise<EvaluationMe | null> {
  return apiFetch<EvaluationMe>(`/concepts/${conceptId}/evaluation/me`);
}

export function putEvaluation(conceptId: string, body: EvaluationPutInput): Promise<EvaluationMe | null> {
  return apiFetch<EvaluationMe>(`/concepts/${conceptId}/evaluation`, { method: "PUT", body: JSON.stringify(body) });
}

// ---- 議論チャット（P.6・scope＝総合/グループ/前提スレッド） ----

export type ConceptChatScopeItem = components["schemas"]["ConceptChatScopeItemDTO"];
export type ConceptChatScopeList = components["schemas"]["ConceptChatScopeListResponse"];
export type ConceptChatMsg = components["schemas"]["ConceptChatMessageDTO"];
export type ConceptChatMsgList = components["schemas"]["ConceptChatMessageListResponse"];

// コンセプトのチャットルーム一覧（総合 overall・グループ group・前提 assumption）。
export function listChatScopes(conceptId: string): Promise<ConceptChatScopeList | null> {
  return apiFetch<ConceptChatScopeList>(`/concepts/${conceptId}/chat-scopes`);
}

// グループルームをオンデマンド作成（owner/quest_admin・ラベルで識別）。
export function createGroupScope(conceptId: string, label: string): Promise<ConceptChatScopeItem | null> {
  return apiFetch<ConceptChatScopeItem>(`/concepts/${conceptId}/chat-scopes`, { method: "POST", body: JSON.stringify({ kind: "group", label }) });
}

// スコープのメッセージ一覧（作成日昇順）。
export function listScopeMessages(scopeId: string): Promise<ConceptChatMsgList | null> {
  return apiFetch<ConceptChatMsgList>(`/concept-chat-scopes/${scopeId}/messages`);
}

// メッセージ投稿（コメント権限＝既定パーティー員）。
export function postScopeMessage(scopeId: string, body: string): Promise<ConceptChatMsg | null> {
  return apiFetch<ConceptChatMsg>(`/concept-chat-scopes/${scopeId}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}

// 既読位置の更新（未読バッジ用）。
export function readScope(scopeId: string, lastReadMessageId: string): Promise<unknown> {
  return apiFetch(`/concept-chat-scopes/${scopeId}/read`, { method: "POST", body: JSON.stringify({ last_read_message_id: lastReadMessageId }) });
}
