// SC-94 会社のLLM設定（FR-45・S.5）の型。表示名(label)・用途(description)は backend（GET /admin/ai-models）が返す
// ＝ピッカー（GET /ai-models）と同一ソース（設計§9.2・DRY）。物理（provider/base_url）は非露出。
import type { components } from "@/lib/api/schema";

export type AdminModelItem = components["schemas"]["AdminModelItem"];
export type AdminModelListResponse = components["schemas"]["AdminModelListResponse"];
export type AdminModelPatchRequest = components["schemas"]["AdminModelPatchRequest"];
export type AiUsageRow = components["schemas"]["AiUsageRow"];

// 論理キー → 「特徴」1行（SC-94 管理画面だけの補足説明＝ピッカーには出さないため backend は持たない）。
// 表示名(label)と用途(description)は backend 由来を使う（上記 DRY）。
const MODEL_FEATURE: Record<string, string> = {
  "qwen3-light": "軽量で応答が速い汎用モデル。自社ホスト（外部送信なし）。",
  "qwen3-swallow": "日本語の生成・文章表現に強いモデル。自社ホスト（外部送信なし）。",
};

export function modelFeature(key: string): string {
  return MODEL_FEATURE[key] ?? "自社ホスト（外部送信なし）。";
}
