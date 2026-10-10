// SC-94 会社のLLM設定（FR-45・S.5）＝backend 管理 EP へ実結線。company_account_admin / system_admin 専用。
import { apiFetch } from "@/lib/api/client";

import type { AdminModelItem, AdminModelListResponse, AdminModelPatchRequest, AiPolicy, AiUsageRow } from "./types";

// カタログ＋自社設定（enabled/billing/monthly_budget_micros/当月利用）。
export async function fetchAdminModels(signal?: AbortSignal): Promise<AdminModelItem[]> {
  const r = await apiFetch<AdminModelListResponse>("/admin/ai-models", { signal });
  return r?.data ?? [];
}

// ON/OFF・予算変更（PATCH）。応答は更新後の一覧（AdminModelListResponse）。
export async function patchAdminModel(key: string, patch: AdminModelPatchRequest): Promise<AdminModelItem[]> {
  const r = await apiFetch<AdminModelListResponse>(`/admin/ai-models/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return r?.data ?? [];
}

// 会社×モデル×月の利用量/コスト集計（ai_usage_events の read 集計）。
export async function fetchAiUsage(params?: { period_ym?: number; model_key?: string }, signal?: AbortSignal): Promise<AiUsageRow[]> {
  const qs = new URLSearchParams();
  if (params?.period_ym != null) qs.set("period_ym", String(params.period_ym));
  if (params?.model_key) qs.set("model_key", params.model_key);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const r = await apiFetch<{ data: AiUsageRow[] }>(`/admin/ai-usage${suffix}`, { signal });
  return r?.data ?? [];
}

// 会社の AI 動作ポリシー取得（公開時自動評価の ON/OFF・S.5b）。
export async function fetchAiPolicy(signal?: AbortSignal): Promise<AiPolicy | null> {
  return apiFetch<AiPolicy>("/admin/ai-policy", { signal });
}

// 会社の AI 動作ポリシー変更。auto_evaluate_on_publish=null はデプロイ既定への継承リセット。
export async function patchAiPolicy(auto_evaluate_on_publish: boolean | null): Promise<AiPolicy | null> {
  return apiFetch<AiPolicy>("/admin/ai-policy", {
    method: "PATCH",
    body: JSON.stringify({ auto_evaluate_on_publish }),
  });
}
