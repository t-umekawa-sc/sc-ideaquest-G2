// C-TC-318（unit）管理者お勧めトグル API クライアント写像＝EP パス/メソッド/ブール body を検証。
// SC-13 発見カタログ（company_account_admin のみ・C.9.1）。EP パス/メソッド誤りの回帰防止（apiFetch はモック）。
// 正＝doc/API設計/C_クエスト・パーティー・権限.md C.9.1。
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn(async () => ({ recommended: true }));
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  idempotencyHeader: () => ({ "Idempotency-Key": "test-key" }),
}));

import { setQuestRecommended } from "./api";

afterEach(() => apiFetch.mockClear());

describe("管理者お勧めトグル API（C-TC-318 unit）", () => {
  it("setQuestRecommended(true) は PUT /quests/{id}/recommended＋body recommended:true", async () => {
    await setQuestRecommended("q1", true);
    const [url, opts] = apiFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/quests/q1/recommended");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ recommended: true });
  });

  it("setQuestRecommended(false) は recommended:false を載せる（解除）", async () => {
    await setQuestRecommended("q2", false);
    const [url, opts] = apiFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/quests/q2/recommended");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ recommended: false });
  });
});
