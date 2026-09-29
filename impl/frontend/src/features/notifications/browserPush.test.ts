// H-TC-301（unit）ブラウザ通知 Tier1 の発火ゲート＝supported/granted/enabled/hidden を全て満たす時のみ true。
//   前景（hidden=false）・未許可・未有効・未対応・ゲーム層の自己報酬（achievement/magic_reaction）・本文なしは出さない。
// 正＝doc/テスト/H_通知.md H-TC-301・doc/要件定義 通知（Tier1・決定 2026-09-29）。
import { describe, expect, it } from "vitest";

import { shouldBrowserNotify, type BrowserNotifyData, type NotifyEnv } from "./browserPush";

const okEnv: NotifyEnv = { supported: true, permission: "granted", enabled: true, hidden: true };
const okData: BrowserNotifyData = { type: "mention", body: "田中さんがあなたをメンションしました" };

describe("H-TC-301 shouldBrowserNotify 発火ゲート", () => {
  it("全条件を満たすと true", () => {
    expect(shouldBrowserNotify(okData, okEnv)).toBe(true);
  });
  it("未対応/未許可/未有効はいずれも false", () => {
    expect(shouldBrowserNotify(okData, { ...okEnv, supported: false })).toBe(false);
    expect(shouldBrowserNotify(okData, { ...okEnv, permission: "denied" })).toBe(false);
    expect(shouldBrowserNotify(okData, { ...okEnv, permission: "default" })).toBe(false);
    expect(shouldBrowserNotify(okData, { ...okEnv, enabled: false })).toBe(false);
  });
  it("前景（hidden=false）では出さない（タブ非アクティブ時のみ）", () => {
    expect(shouldBrowserNotify(okData, { ...okEnv, hidden: false })).toBe(false);
  });
  it("ゲーム層の自己報酬（achievement/magic_reaction）は除外", () => {
    expect(shouldBrowserNotify({ ...okData, type: "achievement" }, okEnv)).toBe(false);
    expect(shouldBrowserNotify({ ...okData, type: "magic_reaction" }, okEnv)).toBe(false);
  });
  it("表示本文が無ければ出さない", () => {
    expect(shouldBrowserNotify({ type: "mention", body: "" }, okEnv)).toBe(false);
  });
});
