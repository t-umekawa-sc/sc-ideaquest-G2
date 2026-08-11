// questgroups 機能の API（§4.1・lib/api 経由）。正＝doc/API設計/B_会社・アカウント・所属.md B.3.1。
// system_admin のクロステナント経路（/admin/companies/{company_id}/quest-groups）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type QuestGroup = components["schemas"]["QuestGroupListItem"];
type QuestGroupListResponse = components["schemas"]["QuestGroupListResponse"];

export function listQuestGroups(companyId: string): Promise<QuestGroupListResponse | null> {
  return apiFetch<QuestGroupListResponse>(`/admin/companies/${companyId}/quest-groups`);
}

export function createQuestGroup(companyId: string, body: { quest_group_code: string; name: string }): Promise<QuestGroup | null> {
  return apiFetch<QuestGroup>(`/admin/companies/${companyId}/quest-groups`, { method: "POST", body: JSON.stringify(body) });
}

export function renameQuestGroup(companyId: string, groupId: string, name: string): Promise<QuestGroup | null> {
  return apiFetch<QuestGroup>(`/admin/companies/${companyId}/quest-groups/${groupId}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteQuestGroup(companyId: string, groupId: string): Promise<null> {
  return apiFetch<null>(`/admin/companies/${companyId}/quest-groups/${groupId}`, { method: "DELETE" }) as Promise<null>;
}
