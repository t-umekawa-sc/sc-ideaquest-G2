// AIジョブ（ドメイン S・FR-45・SC-04）の型。backend schema（S.1）と対応。
// 物理（provider/base_url）は API に出ない＝画面が扱うのは論理キーと状態だけ。
import type { components } from "@/lib/api/schema";

export type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface AiJobListItem {
  id: string;
  task_type: string;
  status: AiJobStatus;
  progress: { phase?: string; ratio?: number; tokens?: number } | null;
  queue_position: number | null; // queued のみ＝会社全体の待ち行列での順位（N番目）
  eta_seconds: number | null;    // queued のみ＝実行開始までの概算秒（履歴無しは null）
  created_at: string;
  finished_at: string | null;
  ref_idea_id: string | null;
  ref_quest_id: string | null;
  ref_strategy_document_id: string | null;
  ref_info_item_id: string | null;
}

export interface AiJobListResult {
  data: AiJobListItem[];
  page_info: { page: number; per_page: number; total: number; has_next: boolean };
}

export interface AiJobSummary {
  queued: number;
  running: number;
  recent_done: number;
  recent_failed: number;
}

// SC-04 上部＝他ユーザ含む会社内 running の進捗率のみ（匿名・S.1a）。依頼者/入力/種別は持たない。
export interface RunningJobItem {
  ratio: number | null;
}

// GET /ai-models（S.2）＝機能内モデルピッカーの供給源（会社で有効な論理キーのみ・設計§9.2）。
// label/description は backend 由来（表示名の単一ソース）＝key は画面に出さず表示名で選ばせる。
export type AiModelItem = components["schemas"]["AiModelItem"];

// ピッカーの初期選択キー＝is_default のキー・無ければ先頭（候補1でも成立・設計§9.2）。
export function defaultModelKey(models: AiModelItem[]): string | null {
  if (!models.length) return null;
  return (models.find((m) => m.is_default) ?? models[0]).key;
}

export interface AiJobDetail {
  id: string;
  task_type: string;
  status: AiJobStatus;
  execution: string;
  requested_model: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_micros: number | null;
  progress: { phase?: string; ratio?: number; tokens?: number } | null;
  error: { code?: string; detail?: string } | null;
  result: { text?: string } | null;
  ref_idea_id: string | null;
  ref_quest_id: string | null;
  ref_strategy_document_id: string | null;
  ref_info_item_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

// task_type → 日本語ラベル（通知 catalog と揃える）。未知はキーをそのまま出す。
export const TASK_LABEL: Record<string, string> = {
  info_summarize: "情報の要約",
  iso_generate: "ISO文書の生成",
  strategy_align_semantic: "方針整合（意味）",
  info_contradiction: "情報の矛盾検出",
  concept_premise_check: "前提の検証",
};

export const STATUS_LABEL: Record<AiJobStatus, string> = {
  queued: "待ち",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  canceled: "キャンセル",
};

// 状態バッジのトーン（デザイン標準のバッジ配色に合わせる）。
export const STATUS_BADGE: Record<AiJobStatus, string> = {
  queued: "badge-muted",
  running: "badge-info",
  succeeded: "badge-success",
  failed: "badge-danger",
  canceled: "badge-muted",
};
