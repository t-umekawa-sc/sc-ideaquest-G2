// 内部情報テンプレート（N.5b・§5.37b・FR-41⑩）API クライアント。管理＝会社管理者／適用＝会社内全員（サーバー権威）。
import { apiFetch, idempotencyHeader } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type InfoTemplateDetail = components["schemas"]["InfoTemplateDetailDTO"];
export type InfoTemplateCreateInput = components["schemas"]["InfoTemplateCreateRequest"];
export type InfoTemplateUpdateInput = components["schemas"]["InfoTemplateUpdateRequest"];

// 一覧（admin=1）とピッカーの応答は list ルートに response_model が無く OpenAPI 未登録のため手書き型
// （backend InfoTemplateAdminDTO / InfoTemplatePickDTO と一致・N.5b）。info-input と同方針。
export interface InfoTemplateAdminItem {
  id: string;
  name: string;
  description?: string | null;
  title_template?: string | null;
  body?: Record<string, unknown> | null;   // 本文ひな形 PM-JSON（編集/複製用）
  defaults?: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
  updated_by?: string | null;
  updated_at: string;
}
export interface InfoTemplateAdminListResponse {
  data: InfoTemplateAdminItem[];
  page_info?: { total?: number; page?: number; per_page?: number };
}
export interface InfoTemplatePick { id: string; name: string; description?: string | null; }

// ---- 管理一覧（会社管理者・admin=1・SC-55） ----
export function listAdminTemplates(signal?: AbortSignal): Promise<InfoTemplateAdminListResponse | null> {
  // マスタは小規模＝全件を1ページで取得しクライアント DataTable で扱う（お知らせ SC-96 と同方針）。
  return apiFetch<InfoTemplateAdminListResponse>(`/info-templates?admin=1&per_page=100`, { signal });
}

// ---- 適用用の1件詳細（会社内全員・有効のみ・SC-51 適用） ----
export function getTemplateDetail(id: string, signal?: AbortSignal): Promise<InfoTemplateDetail | null> {
  return apiFetch<InfoTemplateDetail>(`/info-templates/${encodeURIComponent(id)}`, { signal });
}

// ---- ピッカー供給（会社内全員・有効のみ・SC-51 §6b） ----
export function listPickerTemplates(signal?: AbortSignal): Promise<{ data: InfoTemplatePick[] } | null> {
  return apiFetch<{ data: InfoTemplatePick[] }>(`/info-templates`, { signal });
}

// ---- 書込（会社管理者） ----
export function createTemplate(input: InfoTemplateCreateInput): Promise<InfoTemplateDetail | null> {
  return apiFetch<InfoTemplateDetail>(`/info-templates`, { method: "POST", headers: idempotencyHeader(), body: JSON.stringify(input) });
}

export function updateTemplate(id: string, input: InfoTemplateUpdateInput): Promise<InfoTemplateDetail | null> {
  return apiFetch<InfoTemplateDetail>(`/info-templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function setTemplateActive(id: string, active: boolean): Promise<InfoTemplateDetail | null> {
  const verb = active ? "activate" : "deactivate";
  return apiFetch<InfoTemplateDetail>(`/info-templates/${encodeURIComponent(id)}/${verb}`, { method: "POST" });
}

export function deleteTemplate(id: string): Promise<null> {
  return apiFetch<null>(`/info-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// 本文ひな形の貼付画像＝情報本体と同じ再ホスト EP を流用（自社ホスト署名URL・外部参照/ data: を持ち込まない）。
export { uploadInfoImageApi } from "@/features/info-input/api";
