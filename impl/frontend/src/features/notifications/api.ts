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

// ref から遷移先URLを解決（種別非依存・ref の有無で判定・SC-02 §4.2）。ref 無し（security 等）は null＝遷移なし。
// SC-02 一覧とダッシュボードの「最近の通知」で共有（DRY・コーディング規約 §2.3）。
export function notificationHref(n: NotificationDTO): string | null {
  const r = n.ref ?? {};
  if (r.chat_message_id && r.idea_id) return `/ideas/${r.idea_id}/chat`;
  if (r.idea_id) return `/ideas/${r.idea_id}`;
  if (r.achievement_id) return "/achievements";
  if (r.quest_id) return `/quests/${r.quest_id}`;
  return null;
}

// 通知の既読化を通知一覧へ楽観反映する純ロジック（SC-01/SC-02 共有・テスト規約 unit 層）。
// 対象を is_read=true にし未読数を -1（0 下限）。対象が既読 or 不在なら同一参照を返す＝冪等
// （二重デクリメント防止）。server 権威は次ロードで整合。
export function markNotificationRead<L extends { data: Array<{ id: string; is_read: boolean }>; unread_count: number }>(
  notifs: L,
  id: string,
): L {
  const target = notifs.data.find((x) => x.id === id);
  if (!target || target.is_read) return notifs;
  return {
    ...notifs,
    data: notifs.data.map((x) => (x.id === id ? { ...x, is_read: true } : x)),
    unread_count: Math.max(0, notifs.unread_count - 1),
  } as L;
}
