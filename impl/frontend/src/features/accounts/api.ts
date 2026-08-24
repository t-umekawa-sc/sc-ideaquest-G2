// accounts 機能の API 呼び出し（§4.1・lib/api 経由）。正＝doc/API設計/B_会社・アカウント・所属.md B.2/B.3/B.5。
// system_admin のクロステナント経路（/admin/companies/{company_id}/accounts）を使う（SC-92）。
import { apiFetch } from "@/lib/api/client";
import type { Account, AccountCreateInput, AccountListResponse, AccountResponse, Membership } from "./types";
import type { components } from "@/lib/api/schema";

type QuestGroupListResponse = components["schemas"]["QuestGroupListResponse"];

// 発行/編集/無効化などでアカウント集合が変化したことを一覧へ通知する window イベント（跨ルート更新）。
// URL 付きモーダル（別ルート）は背景一覧を再マウントしないため、成功時に発火し一覧が購読して再取得する
// （COMPANIES_CHANGED_EVENT と同型・将来はサーバーデータ流路へ整理・handoff §5）。
export const ACCOUNTS_CHANGED_EVENT = "ideaquest:accounts-changed";

const FIND_PER_PAGE = 100; // backend 上限。単一アカウントの取得 EP が無いため一覧をループして id で解決する。

// 編集モーダル（URL 化）のプリフィル用。単一取得 EP が無いので一覧を全件ループして id 一致を返す
// （useAllAccounts と同じ流儀・管理系は小〜数百件で妥当）。見つからなければ null（フォームが not-found 表示）。
export async function findAccountById(companyId: string, accountId: string): Promise<Account | null> {
  for (let page = 1; ; page += 1) {
    const res = await listAccounts(companyId, { page, per_page: FIND_PER_PAGE });
    const batch = res?.data ?? [];
    const hit = batch.find((a) => a.account_id === accountId);
    if (hit) return hit;
    const total = res?.page_info.total ?? batch.length;
    if (batch.length === 0 || page * FIND_PER_PAGE >= total) return null;
  }
}

export async function findOwnAccountById(accountId: string): Promise<Account | null> {
  for (let page = 1; ; page += 1) {
    const res = await listOwnAccounts({ page, per_page: FIND_PER_PAGE });
    const batch = res?.data ?? [];
    const hit = batch.find((a) => a.account_id === accountId);
    if (hit) return hit;
    const total = res?.page_info.total ?? batch.length;
    if (batch.length === 0 || page * FIND_PER_PAGE >= total) return null;
  }
}

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

// メールアドレス確認リンクを現メール宛に送信（B.2・system_admin・ADR-0009・202）。
export function sendEmailVerification(companyId: string, accountId: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/admin/companies/${companyId}/accounts/${accountId}/email-verification`, { method: "POST" });
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

// 自社アカウントに確認リンクを送信（B.2.1・company_account_admin・ADR-0009・202）。
export function sendOwnEmailVerification(accountId: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>(`/admin/accounts/${accountId}/email-verification`, { method: "POST" });
}

// メールアドレス確認の確定（公開・未認証＝トークンが認可・ADR-0009）。410/409 はハンドル側で判定。
export function confirmEmailVerify(token: string): Promise<{ status: string } | null> {
  return apiFetch<{ status: string }>("/auth/email-verify/confirm", { method: "POST", body: JSON.stringify({ token }) });
}
