// G-TC-161: 魔法 canvas ハーネスの reduce-motion 分岐（純ロジック・デザイン標準 §4.9）。
// 各エンジン unit は決定的純関数のみで reduce 分岐は対象外（G-TC-155..160）。その分岐判定の正を
// ハーネス側で担保する（記憶 animation-reduce-motion-standard＝抑制 ON/OFF をテスト必須）。
import { describe, expect, it } from "vitest";

import { planSpellLifecycle } from "./useSpellEngine";

describe("planSpellLifecycle (G-TC-161)", () => {
  it("reduce-motion は hasIO によらず static（rAF/IO を起動しない）", () => {
    expect(planSpellLifecycle(true, true)).toBe("static");
    expect(planSpellLifecycle(true, false)).toBe("static");
  });
  it("非抑制で IO ありは observe（可視で発射・画面外停止）", () => {
    expect(planSpellLifecycle(false, true)).toBe("observe");
  });
  it("非抑制で IO なし（SSR/jsdom）は immediate（即発射）", () => {
    expect(planSpellLifecycle(false, false)).toBe("immediate");
  });
});
