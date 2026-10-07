// お知らせ（ドメイン U・FR-49）API クライアント。閲覧＝全ユーザー／管理＝管理者（サーバー権威）。
import { apiFetch, idempotencyHeader } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type AnnouncementListItem = components["schemas"]["AnnouncementListItem"];
export type AnnouncementListResponse = components["schemas"]["AnnouncementListResponse"];
export type AnnouncementDetail = components["schemas"]["AnnouncementDetail"];
export type AdminAnnouncementItem = components["schemas"]["AdminAnnouncementItem"];
export type AdminAnnouncementListResponse = components["schemas"]["AdminAnnouncementListResponse"];
export type AnnouncementCreateInput = components["schemas"]["AnnouncementCreateRequest"];
export type AnnouncementUpdateInput = components["schemas"]["AnnouncementUpdateRequest"];

export const ANNOUNCEMENTS_CHANGED_EVENT = "ideaquest:announcements-changed";

// ---- 閲覧（全ユーザー・U.1） ----
export function listAnnouncements(opts?: { cursor?: string | null; limit?: number; unread?: boolean }, signal?: AbortSignal): Promise<AnnouncementListResponse | null> {
  const qs = new URLSearchParams();
  if (opts?.cursor) qs.set("cursor", opts.cursor);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.unread) qs.set("unread", "true");
  return apiFetch<AnnouncementListResponse>(`/announcements?${qs.toString()}`, { signal });
}

export function getAnnouncement(id: string, signal?: AbortSignal): Promise<AnnouncementDetail | null> {
  return apiFetch<AnnouncementDetail>(`/announcements/${id}`, { signal });
}

export function markAnnouncementRead(id: string): Promise<{ is_read: boolean } | null> {
  return apiFetch<{ is_read: boolean }>(`/announcements/${id}/read`, { method: "POST", headers: idempotencyHeader() });
}

// ---- 管理（管理者のみ・U.2） ----
export function listAdminAnnouncements(signal?: AbortSignal): Promise<AdminAnnouncementListResponse | null> {
  return apiFetch<AdminAnnouncementListResponse>(`/admin/announcements`, { signal });
}

export function createAnnouncement(input: AnnouncementCreateInput): Promise<unknown> {
  return apiFetch(`/admin/announcements`, { method: "POST", headers: idempotencyHeader(), body: JSON.stringify(input) });
}

export function updateAnnouncement(id: string, input: AnnouncementUpdateInput): Promise<unknown> {
  return apiFetch(`/admin/announcements/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteAnnouncement(id: string): Promise<null> {
  return apiFetch<null>(`/admin/announcements/${id}`, { method: "DELETE" });
}

// 本文貼付画像の再ホスト（POST /admin/announcements/images・U-8）＝multipart・管理者のみ。
// エディタの挿入/paste/ドロップが blob を送り、返った自社ホスト署名 URL で img src を置換する（外部参照・data: を持ち込まない）。
export async function uploadAnnouncementImageApi(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch<{ url: string }>("/admin/announcements/images", { method: "POST", body: form });
  return (res as { url: string }).url;
}
