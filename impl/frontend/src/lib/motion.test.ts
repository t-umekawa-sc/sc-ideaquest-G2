// K-TC-021: アニメ抑制の実効判定（純ロジック・デザイン標準 §4.9）。実効 = OS reduce OR ユーザー設定。
import { describe, expect, it } from "vitest";

import { isMotionReduced } from "./motion";

describe("isMotionReduced (K-TC-021)", () => {
  it("OS reduce は最優先の下限＝常に抑制（ユーザー設定で ON に戻せない）", () => {
    expect(isMotionReduced(true, false)).toBe(true);
    expect(isMotionReduced(true, true)).toBe(true);
  });
  it("OS 通常でも、ユーザーが OFF なら抑制", () => {
    expect(isMotionReduced(false, true)).toBe(true);
  });
  it("OS 通常＋ユーザー ON（既定）なら演出あり", () => {
    expect(isMotionReduced(false, false)).toBe(false);
  });
});
