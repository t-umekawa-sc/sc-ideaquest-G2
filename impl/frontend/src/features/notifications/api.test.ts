// H-TC-209（unit）notificationHref＝通知 ref から遷移先URLへ写像（chat_message_id+idea_id→/ideas/{id}/chat・
//   idea_id→/ideas/{id}・achievement_id→/achievements・quest_id→/quests/{id}・ref 無し→null）。SC-01/SC-02 共有。
//   受入不具合 DFT-E-003（ダッシュボード「最近の通知」が非リンク）の再発防止。
// H-TC-210（unit）markNotificationRead＝既読化を通知一覧へ楽観反映（対象 is_read=true・unread_count -1・0 下限）／
//   既読 or 不在は同一参照＝冪等（二重デクリメントしない）。受入不具合 DFT-E-004（通知クリックで既読化）の再発防止。
// 正＝doc/テスト/H_通知.md・SC-02 §4.2。
import { describe, expect, it } from "vitest";
import { markNotificationRead, notificationHref, type NotificationDTO } from "./api";

function notif(ref: Record<string, string>, type?: string): NotificationDTO {
  return { ref, type } as unknown as NotificationDTO;
}

describe("H-TC-209 notificationHref", () => {
  it("chat_message_id+idea_id → チャットURL", () => {
    expect(notificationHref(notif({ chat_message_id: "c1", idea_id: "i1" }))).toBe("/ideas/i1/chat");
  });
  it("idea_id → アイデアURL", () => {
    expect(notificationHref(notif({ idea_id: "i1" }))).toBe("/ideas/i1");
  });
  it("achievement_id → 実績", () => {
    expect(notificationHref(notif({ achievement_id: "a1" }))).toBe("/achievements");
  });
  it("quest_id → クエストURL", () => {
    expect(notificationHref(notif({ quest_id: "q1" }))).toBe("/quests/q1");
  });
  it("quest_watch_update（フォロー更新＝非メンバー）→ 発見カタログ（メンバー内容は開かない）", () => {
    expect(notificationHref(notif({ quest_id: "q1" }, "quest_watch_update"))).toBe("/quest-catalog");
    // 結果/招集などメンバー宛の quest 系は従来どおり /quests/{id}。
    expect(notificationHref(notif({ quest_id: "q1" }, "quest_result_ready"))).toBe("/quests/q1");
  });
  it("ref 無し → null（遷移なし）", () => {
    expect(notificationHref({} as unknown as NotificationDTO)).toBeNull();
  });
});

describe("H-TC-211 notificationHref join_request_received（申請者ダイアログ直開き）", () => {
  it("quest_id＋user_id → /quests/{id}?joinreq={applicant}", () => {
    expect(notificationHref(notif({ quest_id: "q1", user_id: "u9" }, "join_request_received"))).toBe("/quests/q1?joinreq=u9");
  });
  it("user_id 欠落 → /quests/{id} にフォールバック", () => {
    expect(notificationHref(notif({ quest_id: "q1" }, "join_request_received"))).toBe("/quests/q1");
  });
});

describe("H-TC-210 markNotificationRead", () => {
  const base = () => ({
    data: [
      { id: "n1", is_read: false },
      { id: "n2", is_read: false },
    ],
    unread_count: 2,
  });
  it("未読を既読化＝対象 is_read true・他は不変・unread_count -1", () => {
    const r = markNotificationRead(base(), "n1");
    expect(r.data.find((x) => x.id === "n1")!.is_read).toBe(true);
    expect(r.data.find((x) => x.id === "n2")!.is_read).toBe(false);
    expect(r.unread_count).toBe(1);
  });
  it("既読の通知は同一参照を返す（冪等・二重デクリメントしない）", () => {
    const already = { data: [{ id: "n1", is_read: true }], unread_count: 0 };
    expect(markNotificationRead(already, "n1")).toBe(already);
  });
  it("不在 id は同一参照を返す（不変）", () => {
    const s = base();
    expect(markNotificationRead(s, "zzz")).toBe(s);
  });
  it("unread_count は 0 下限（負にならない）", () => {
    const s = { data: [{ id: "n1", is_read: false }], unread_count: 0 };
    expect(markNotificationRead(s, "n1").unread_count).toBe(0);
  });
});
