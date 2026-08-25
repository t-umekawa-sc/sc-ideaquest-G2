// evaluations 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/F_評価.md F.1〜F.3。
// backend＝GET evaluation/me（自分の評価）・GET evaluation（集計・visibility 適用）・PUT evaluation（draft/submitted）
// ・POST/DELETE select（選定・owner/quest_admin）。可否はサーバー権威（フロントは my_permissions で UX 出し分け）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type EvaluationMe = components["schemas"]["EvaluationMeDTO"];
export type EvaluationAggregate = components["schemas"]["EvaluationAggregateDTO"];
export type EvaluationEvaluator = components["schemas"]["EvaluationEvaluatorDTO"];
export type EvaluationCoin = components["schemas"]["EvaluationCoinDTO"];
export type EvaluationPutInput = components["schemas"]["EvaluationPutRequest"];
export type EvaluationVisibility = EvaluationPutInput["visibility"];
export type IdeaSelectResult = components["schemas"]["IdeaSelectResponse"];

// 自分の評価/下書き（SC-25 読み込み・F.1）。門番＋evaluator 権限はサーバー強制（範囲外 404／権限なし 403）。
export function getMyEvaluation(ideaId: string): Promise<EvaluationMe | null> {
  return apiFetch<EvaluationMe>(`/ideas/${ideaId}/evaluation/me`);
}

// 評価結果の集計（SC-22 §4.6・F.1）。可視な評価のみ・limited は範囲外非表示・coin は全 submitted で見込み。
export function getEvaluationAggregate(ideaId: string): Promise<EvaluationAggregate | null> {
  return apiFetch<EvaluationAggregate>(`/ideas/${ideaId}/evaluation`);
}

// 自分の評価を登録/更新（SC-25・F.2）。submitted は全5観点＋総評をサーバー検証（422）＋評価者 XP+30。
export function putEvaluation(ideaId: string, input: EvaluationPutInput): Promise<EvaluationMe | null> {
  return apiFetch<EvaluationMe>(`/ideas/${ideaId}/evaluation`, { method: "PUT", body: JSON.stringify(input) });
}

// アイデアを選定（F.3・owner/quest_admin）。投稿者へ XP+200（初回・剥奪なし）。完了は 409。
export function selectIdea(ideaId: string): Promise<IdeaSelectResult | null> {
  return apiFetch<IdeaSelectResult>(`/ideas/${ideaId}/select`, { method: "POST" });
}

// 選定を解除（F.3・owner/quest_admin）。XP は剥奪しない。完了は 409。
export function unselectIdea(ideaId: string): Promise<IdeaSelectResult | null> {
  return apiFetch<IdeaSelectResult>(`/ideas/${ideaId}/select`, { method: "DELETE" });
}
