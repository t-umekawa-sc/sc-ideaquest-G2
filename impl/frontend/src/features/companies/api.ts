// companies 機能の API 呼び出し（§4.1・lib/api 経由・業務計算はしない）。正＝doc/API設計/B_会社・アカウント・所属.md B.1。
import { apiFetch } from "@/lib/api/client";
import type { CompanyCreateInput, CompanyDetail, CompanyListResponse } from "./types";

export function listCompanies(params?: {
  q?: string;
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<CompanyListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.status) qs.set("status", params.status);
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<CompanyListResponse>(`/admin/companies${suffix}`);
}

// 会社を新規作成（B.1）。`status=suspended` で作成される。CSRF は apiFetch が付与。
export function createCompany(input: CompanyCreateInput): Promise<CompanyDetail | null> {
  return apiFetch<CompanyDetail>("/admin/companies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
