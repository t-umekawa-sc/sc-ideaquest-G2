import { describe, it, expect } from "vitest";

import { mulberry32, genPath, LEARN_BOUNCES, LEARN_SEEDS, pickLearnSeed, planLearn } from "./learnFx";

// 魔法解放の共通「習得」演出の決定的な純ロジック（G-TC-162）。
// canvas 描画/rAF・アイコン開封・reduce 時の即解放は GF-AC ブラウザ受入に委ね、ここでは決定的部分のみ担保。
describe("learnFx（魔法解放「習得」演出の純ロジック・G-TC-162）", () => {
  it("genPath は BOUNCES+1 点を返し、各頂点は半径 R 上（円で反射）", () => {
    const R = 46;
    const pts = genPath(R, mulberry32(123));
    expect(pts).toHaveLength(LEARN_BOUNCES + 1);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(R, 3);
  });

  it("同 seed は同経路・異 seed は異なる（決定的・再現可能）", () => {
    const a = genPath(46, mulberry32(999));
    const b = genPath(46, mulberry32(999));
    const c = genPath(46, mulberry32(1000));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("mulberry32 は同 seed で同数列・各値は [0,1)", () => {
    const r1 = mulberry32(7);
    const r2 = mulberry32(7);
    const s1 = [r1(), r1(), r1()];
    const s2 = [r2(), r2(), r2()];
    expect(s1).toEqual(s2);
    for (const v of s1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("pickLearnSeed は選定済み seed のいずれかを返す（範囲端も安全）", () => {
    expect(LEARN_SEEDS).toContain(pickLearnSeed(0));
    expect(LEARN_SEEDS).toContain(pickLearnSeed(0.999999));
    expect(LEARN_SEEDS).toContain(pickLearnSeed(0.5));
  });

  it("planLearn は抑制で static・非抑制で animate", () => {
    expect(planLearn(true)).toBe("static");
    expect(planLearn(false)).toBe("animate");
  });
});
