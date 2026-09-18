// C-TC-274（unit）参加リクエスト受信側 API クライアント写像＝EP パス/メソッド/クエリ/Idempotency を検証。
// SC-12 パーティータブ（FR-40 受信側・C.9.1）。EP パス/メソッド誤りの回帰防止（apiFetch はモック）。
// 正＝doc/API設計/C_クエスト・パーティー・権限.md C.9.1。
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn(async () => ({}));
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  idempotencyHeader: () => ({ "Idempotency-Key": "test-key" }),
}));

import { approveJoinRequest, listJoinRequests, rejectJoinRequest } from "./api";

afterEach(() => apiFetch.mockClear());

describe("参加リクエスト受信側 API（C-TC-274 unit）", () => {
  it("listJoinRequests は GET /quests/{id}/join-requests（既定＝status クエリ無し）", async () => {
    await listJoinRequests("q1");
    expect(apiFetch).toHaveBeenCalledWith("/quests/q1/join-requests");
  });

  it("listJoinRequests は status を反復クエリで載せる", async () => {
    await listJoinRequests("q1", ["pending", "rejected"]);
    expect(apiFetch).toHaveBeenCalledWith("/quests/q1/join-requests?status=pending&status=rejected");
  });

  it("approveJoinRequest は POST .../{uid}/approve＋Idempotency-Key", async () => {
    await approveJoinRequest("q1", "u2");
    const [url, opts] = apiFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("/quests/q1/join-requests/u2/approve");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toMatchObject({ "Idempotency-Key": "test-key" });
  });

  it("rejectJoinRequest は POST .../{uid}/reject", async () => {
    await rejectJoinRequest("q1", "u2");
    const [url, opts] = apiFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe("/quests/q1/join-requests/u2/reject");
    expect(opts.method).toBe("POST");
  });
});
