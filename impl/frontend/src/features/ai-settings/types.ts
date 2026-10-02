// SC-94 会社のLLM設定（FR-45・S.5）の型。backend は論理キーのみ返すため、表示名・特徴・用途は
// フロントの metadata マップで補う（SC-94 §4.1・決定 2026-10-02）。物理（provider/base_url）は非露出。
import type { components } from "@/lib/api/schema";

export type AdminModelItem = components["schemas"]["AdminModelItem"];
export type AdminModelListResponse = components["schemas"]["AdminModelListResponse"];
export type AdminModelPatchRequest = components["schemas"]["AdminModelPatchRequest"];
export type AiUsageRow = components["schemas"]["AiUsageRow"];

// 論理キー → 表示名・特徴・用途（Phase1＝qwen3-light / qwen3-swallow の2キー）。
// 管理者が「どのモデルを何に使うか」を判断できるようにする（ユーザー要望 2026-10-02）。
export const MODEL_META: Record<string, { name: string; feature: string; use: string }> = {
  "qwen3-light": {
    name: "Qwen3 Light（軽量・高速）",
    feature: "軽量で応答が速い汎用モデル。自社ホスト（外部送信なし）。",
    use: "要約・短文整形・分類など軽めの処理に向く。",
  },
  "qwen3-swallow": {
    name: "Qwen3 Swallow（日本語生成）",
    feature: "日本語の生成・文章表現に強いモデル。自社ホスト（外部送信なし）。",
    use: "アイデア整形・説明文生成・長めの要約に向く。",
  },
};

export function modelMeta(key: string): { name: string; feature: string; use: string } {
  return MODEL_META[key] ?? { name: key, feature: "—", use: "—" };
}
