// notifications 機能の API 呼び出し（§4.1・lib/api 経由）。正＝ドメイン H・SC-02。
// backend＝GET /notifications（一覧＋未読数・取得時レンダリング済み body）・GET /notifications/unread-count・
// POST /notifications/{id}/read・/unread・/read-all。すべて自分宛スコープ（IDOR 404）。生成はサーバー（発火ドメイン）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type NotificationDTO = components["schemas"]["NotificationDTO"];
export type NotificationListResponse = components["schemas"]["NotificationListResponse"];

export function getNotifications(params?: { state?: string; type?: string[]; limit?: number; cursor?: string }): Promise<NotificationListResponse | null> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set("state", params.state);
  for (const t of params?.type ?? []) qs.append("type", t);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.cursor) qs.set("cursor", params.cursor);
  const q = qs.toString();
  return apiFetch<NotificationListResponse>(`/notifications${q ? `?${q}` : ""}`);
}

export function getUnreadCount(): Promise<{ unread_count: number } | null> {
  return apiFetch<{ unread_count: number }>(`/notifications/unread-count`);
}

export function markRead(id: string): Promise<{ id: string; is_read: boolean; unread_count: number } | null> {
  return apiFetch(`/notifications/${id}/read`, { method: "POST" });
}

export function markUnread(id: string): Promise<{ id: string; is_read: boolean; unread_count: number } | null> {
  return apiFetch(`/notifications/${id}/unread`, { method: "POST" });
}

export function markAllRead(type?: string): Promise<{ updated: number; unread_count: number } | null> {
  return apiFetch(`/notifications/read-all`, { method: "POST", body: JSON.stringify(type ? { type } : {}) });
}
