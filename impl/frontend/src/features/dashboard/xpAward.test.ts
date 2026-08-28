// I-TC-152: 投票獲得 XP の楽観バー前進％のクランプ（#8 獲得フィードバック・純ロジック）。視覚はブラウザ受入（GF-AC）。
import { describe, expect, it } from "vitest";

import { VOTE_XP, bumpedXpPct } from "./xpAward";

describe("bumpedXpPct (I-TC-152)", () => {
  it("bump=0 は基準％と一致", () => {
    expect(bumpedXpPct(50, 100, 0)).toBe(50);
    expect(bumpedXpPct(0, 100, 0)).toBe(0);
  });
  it("bump 分だけ前進（round）", () => {
    expect(bumpedXpPct(50, 100, 5)).toBe(55);
    expect(bumpedXpPct(48, 100, 5)).toBe(53);
  });
  it("levelSpan 超過は 100% にクランプ（レベルアップは詐称しない）", () => {
    expect(bumpedXpPct(98, 100, 5)).toBe(100);
    expect(bumpedXpPct(100, 100, 25)).toBe(100);
  });
  it("負の合算は 0 にクランプ", () => {
    expect(bumpedXpPct(3, 100, -10)).toBe(0);
  });
  it("levelSpan≤0 は 0", () => {
    expect(bumpedXpPct(10, 0, 5)).toBe(0);
    expect(bumpedXpPct(10, -5, 5)).toBe(0);
  });
});

describe("VOTE_XP (I-TC-152)", () => {
  it("暫定＝仕様固定 +5（backend delta 移行で解消）", () => {
    expect(VOTE_XP).toBe(5);
  });
});
