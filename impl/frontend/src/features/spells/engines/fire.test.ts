// G-TC-156: 炎 canvas エンジンの決定的部分（解像度／可読性フェード）。
// canvas 本体（延焼のセルオートマトン・rng spawn・rAF）は非決定的なので GF-AC 受入に委ね、
// ここでは決定的に抽出した fireGrid（ドット絵解像度）と fireFade（文字可読性フェード）のみ担保する。
import { describe, it, expect } from "vitest";
import { fireGrid, fireFade, FIRE_FADE_MIN, FIRE_FADE_SOLID } from "./fire";

describe("fireGrid（G-TC-156・実寸→低解像度グリッド）", () => {
  it("cols/rows は整数で下限 140×20 にクランプされる", () => {
    const g = fireGrid(0, 0);
    expect(Number.isInteger(g.cols)).toBe(true);
    expect(Number.isInteger(g.rows)).toBe(true);
    expect(g.cols).toBeGreaterThanOrEqual(140);
    expect(g.rows).toBeGreaterThanOrEqual(20);
  });

  it("十分大きい実寸では cols≈round(w/scale)（幅広ほどセル数が増える・単調非減少）", () => {
    const scale = 3;
    const narrow = fireGrid(600, 120, scale);
    const wide = fireGrid(1200, 120, scale);
    expect(narrow.cols).toBe(Math.round(600 / scale));
    expect(wide.cols).toBe(Math.round(1200 / scale));
    expect(wide.cols).toBeGreaterThan(narrow.cols);
    // rows も同様に h/scale
    expect(fireGrid(600, 300, scale).rows).toBe(Math.round(300 / scale));
  });

  it("決定的（同じ入力は同じ出力）", () => {
    expect(fireGrid(1000, 200)).toEqual(fireGrid(1000, 200));
  });
});

describe("fireFade（G-TC-156・可読性フェード：根元不透明→上端透過）", () => {
  it("根元（above≤FIRE_FADE_SOLID）は完全不透明 1", () => {
    for (let a = 0; a <= FIRE_FADE_SOLID; a++) expect(fireFade(a)).toBe(1);
  });

  it("above が増えるほど単調非増加（上へ行くほど透ける）", () => {
    let prev = fireFade(0);
    for (let a = 1; a <= 40; a++) {
      const cur = fireFade(a);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });

  it("下限 FIRE_FADE_MIN でクランプ＝上端でも文字が完全には消えない（0 未満にならない）", () => {
    expect(fireFade(9999)).toBe(FIRE_FADE_MIN);
    for (let a = 0; a <= 200; a++) expect(fireFade(a)).toBeGreaterThanOrEqual(FIRE_FADE_MIN);
  });

  it("決定的（同じ入力は同じ出力）", () => {
    expect(fireFade(10)).toBe(fireFade(10));
  });
});
