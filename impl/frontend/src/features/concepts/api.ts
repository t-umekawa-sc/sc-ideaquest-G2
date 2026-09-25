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

export function listConcepts(questId: string): Promise<ConceptListResponse | null> {
  return apiFetch<ConceptListResponse>(`/quests/${questId}/concepts`);
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
