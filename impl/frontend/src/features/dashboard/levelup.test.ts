// I-TC-151: レベルアップ祝福の発火判定（純ロジック・SC-01）。視覚はブラウザ受入。
import { describe, expect, it } from "vitest";

import { nextStoredLevel, parseSeenLevel, shouldCelebrateLevelUp } from "./levelup";

describe("shouldCelebrateLevelUp (I-TC-151)", () => {
  it("初回観測(null)は祝福しない（記録のみ）", () => {
    expect(shouldCelebrateLevelUp(null, 5)).toBe(false);
  });
  it("上昇時のみ祝福", () => {
    expect(shouldCelebrateLevelUp(4, 5)).toBe(true);
    expect(shouldCelebrateLevelUp(4, 7)).toBe(true);
  });
  it("同値・低下は祝福しない", () => {
    expect(shouldCelebrateLevelUp(5, 5)).toBe(false);
    expect(shouldCelebrateLevelUp(6, 5)).toBe(false);
  });
});

describe("nextStoredLevel (I-TC-151)", () => {
  it("初回は current を記録", () => {
    expect(nextStoredLevel(null, 5)).toBe(5);
  });
  it("上昇・低下いずれも current に追随（古い値で固まらない）", () => {
    expect(nextStoredLevel(4, 5)).toBe(5);
    expect(nextStoredLevel(6, 5)).toBe(5);
  });
  it("同値は据え置き", () => {
    expect(nextStoredLevel(5, 5)).toBe(5);
  });
});

describe("parseSeenLevel (I-TC-151)", () => {
  it("未記録/不正/1未満は null", () => {
    expect(parseSeenLevel(null)).toBeNull();
    expect(parseSeenLevel("abc")).toBeNull();
    expect(parseSeenLevel("0")).toBeNull();
    expect(parseSeenLevel("-3")).toBeNull();
  });
  it("正の整数は数値化（小数は切り捨て）", () => {
    expect(parseSeenLevel("5")).toBe(5);
    expect(parseSeenLevel("7.9")).toBe(7);
  });
});
