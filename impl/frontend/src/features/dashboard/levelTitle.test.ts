// I-TC-153: レベル→称号/ティアの決定（#21・純ロジック）。視覚（称号表示・オーラ）はブラウザ受入（GF-AC）。
import { describe, expect, it } from "vitest";

import { levelRank } from "./levelTitle";

describe("levelRank (I-TC-153)", () => {
  it("しきい値以上で最上位の称号/tier を返す", () => {
    expect(levelRank(1)).toEqual({ title: "見習い", tier: "novice" });
    expect(levelRank(5)).toEqual({ title: "駆け出し", tier: "apprentice" });
    expect(levelRank(10)).toEqual({ title: "一人前", tier: "adept" });
    expect(levelRank(20)).toEqual({ title: "熟練", tier: "expert" });
    expect(levelRank(35)).toEqual({ title: "達人", tier: "master" });
    expect(levelRank(50)).toEqual({ title: "英雄", tier: "mythic" });
    expect(levelRank(70)).toEqual({ title: "伝説", tier: "legend" });
    expect(levelRank(999)).toEqual({ title: "伝説", tier: "legend" });
  });
  it("境界直下は下位の称号", () => {
    expect(levelRank(4).title).toBe("見習い");
    expect(levelRank(9).title).toBe("駆け出し");
    expect(levelRank(19).title).toBe("一人前");
    expect(levelRank(69).title).toBe("英雄");
  });
  it("0/負/NaN/1未満は 1 扱い（見習い）", () => {
    expect(levelRank(0).tier).toBe("novice");
    expect(levelRank(-5).tier).toBe("novice");
    expect(levelRank(Number.NaN).tier).toBe("novice");
  });
  it("小数は floor", () => {
    expect(levelRank(9.9).title).toBe("駆け出し");
    expect(levelRank(10.1).title).toBe("一人前");
  });
});
