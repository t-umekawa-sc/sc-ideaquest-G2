// qgadmin（QG管理者）機能の API（§4.1・lib/api 経由）。正＝doc/API設計/B_会社・アカウント・所属.md B.4。
// セッション会社固定（company_id を受けない）。認可は per-group（当該グループの admin 所属・サーバー判定）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type QuestGroup = components["schemas"]["QuestGroupListItem"];
export type Member = components["schemas"]["MemberListItem"];
export type DirectoryEntry = components["schemas"]["DirectoryItem"];
type QuestGroupListResponse = components["schemas"]["QuestGroupListResponse"];
type MemberListResponse = components["schemas"]["MemberListResponse"];
type DirectoryResponse = components["schemas"]["DirectoryResponse"];

// 自分が admin のグループ一覧（0 件なら backend は 403＝SC-90 到達不可）。
export function listMyGroups(): Promise<QuestGroupListResponse | null> {
  return apiFetch<QuestGroupListResponse>("/admin/quest-groups");
}

export function listGroupMembers(groupId: string, q?: string): Promise<MemberListResponse | null> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<MemberListResponse>(`/admin/quest-groups/${groupId}/members${suffix}`);
}

// 既存アカウントを自グループに参加追加（role=member 固定＝admin 任命不可）。
export function addMember(groupId: string, accountId: string): Promise<components["schemas"]["MembershipResponse"] | null> {
  return apiFetch(`/admin/quest-groups/${groupId}/members`, { method: "POST", body: JSON.stringify({ account_id: accountId }) });
}

export function removeMember(groupId: string, accountId: string): Promise<null> {
  return apiFetch<null>(`/admin/quest-groups/${groupId}/members/${accountId}`, { method: "DELETE" }) as Promise<null>;
}

// 自社ディレクトリ（参加追加の候補・最小射影）。
export function companyDirectory(q?: string): Promise<DirectoryResponse | null> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<DirectoryResponse>(`/admin/company-directory${suffix}`);
}
