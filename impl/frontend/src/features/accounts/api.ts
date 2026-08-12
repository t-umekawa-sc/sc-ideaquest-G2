// accounts 機能の API 呼び出し（§4.1・lib/api 経由）。正＝doc/API設計/B_会社・アカウント・所属.md B.2/B.3/B.5。
// system_admin のクロステナント経路（/admin/companies/{company_id}/accounts）を使う（SC-92）。
import { apiFetch } from "@/lib/api/client";
import type { AccountCreateInput, AccountListResponse, AccountResponse, Membership } from "./types";
import type { components } from "@/lib/api/schema";

type QuestGroupListResponse = components["schemas"]["QuestGroupListResponse"];

export function listAccounts(
  companyId: string,
  params?: { q?: string; status?: string; page?: number; per_page?: number },
): Promise<AccountListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  if (params?.q) qs.set("q", params.q);
  if (params?.status) qs.set("status", params.status);
  return apiFetch<AccountListResponse>(`/admin/companies/${companyId}/accounts?${qs.toString()}`);
}

export function issueAccount(
  companyId: string,
  body: { display_name: string; login_id: string; email: string; system_role: AccountCreateInput["system_role"]; memberships: Membership[] },
): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/companies/${companyId}/accounts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// アカウント編集（B.2・差分）。identity は会社内一意再検証（409）。memberships を含めると希望有効所属の
// 全集合として差分適用（B.3・omitted は解除）＝呼び出し側は「置き換える」時のみ memberships を渡す。
export function editAccount(
  companyId: string,
  accountId: string,
  body: {
    display_name?: string;
    login_id?: string;
    email?: string;
    system_role?: AccountCreateInput["system_role"];
    memberships?: Membership[];
  },
): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/companies/${companyId}/accounts/${accountId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function disableAccount(companyId: string, accountId: string): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/companies/${companyId}/accounts/${accountId}/disable`, { method: "POST" });
}

export function enableAccount(companyId: string, accountId: string): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/companies/${companyId}/accounts/${accountId}/enable`, { method: "POST" });
}

export function resetPassword(companyId: string, accountId: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/admin/companies/${companyId}/accounts/${accountId}/password-reset`, { method: "POST" });
}

// 所属エディタの候補＝この会社のクエストグループ一覧（B.3）。
export function listQuestGroups(companyId: string): Promise<QuestGroupListResponse | null> {
  return apiFetch<QuestGroupListResponse>(`/admin/companies/${companyId}/quest-groups`);
}

// --- SC-93 会社アカウント管理者（B.2.1・`/admin/accounts`＝セッション会社固定・system_role は受けない） ---
export function listOwnAccounts(
  params?: { q?: string; status?: string; page?: number; per_page?: number },
): Promise<AccountListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  if (params?.q) qs.set("q", params.q);
  if (params?.status) qs.set("status", params.status);
  return apiFetch<AccountListResponse>(`/admin/accounts?${qs.toString()}`);
}

export function issueOwnAccount(body: { display_name: string; login_id: string; email: string; memberships?: Membership[] }): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>("/admin/accounts", { method: "POST", body: JSON.stringify(body) });
}

export function editOwnAccount(accountId: string, body: { display_name?: string; login_id?: string; email?: string; memberships?: Membership[] }): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/accounts/${accountId}`, { method: "PATCH", body: JSON.stringify(body) });
}

// 自社のクエストグループ一覧（B.2.1・所属エディタの候補・セッション会社固定）。
export function listOwnCompanyQuestGroups(): Promise<QuestGroupListResponse | null> {
  return apiFetch<QuestGroupListResponse>("/admin/company-quest-groups");
}

export function disableOwnAccount(accountId: string): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/accounts/${accountId}/disable`, { method: "POST" });
}

export function enableOwnAccount(accountId: string): Promise<AccountResponse | null> {
  return apiFetch<AccountResponse>(`/admin/accounts/${accountId}/enable`, { method: "POST" });
}

export function resetOwnPassword(accountId: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/admin/accounts/${accountId}/password-reset`, { method: "POST" });
}
