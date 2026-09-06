// G-TC-160: オーラ canvas エンジンの決定的部分（グリッド解像度／下辺可読性フェード）。
// canvas 本体（縁から立ち上るドット絵オーラのセルオートマトン・波動/応援記号の飛来・紫↔金↔青の色巡回＝rng・
// rAF 駆動）は §17L-g／実アプリの GF-AC ブラウザ受入に委ね、決定的に抽出した auraGrid（セルグリッド解像度）と
// auraBotFade（下辺の可読性フェード）のみ担保する。
import { describe, it, expect } from "vitest";
import { auraGrid, auraBotFade } from "./aura";

describe("auraGrid（G-TC-160・実寸→セルグリッド）", () => {
  it("gw/gh は整数で 1 以上・gw≈ceil(w/cell)", () => {
    const g = auraGrid(424, 214, 8);
    expect(Number.isInteger(g.gw)).toBe(true);
    expect(Number.isInteger(g.gh)).toBe(true);
    expect(g.gw).toBe(Math.ceil(424 / 8));
    expect(g.gh).toBe(Math.ceil(214 / 8));
  });

  it("0 でも 1 以上にクランプ", () => {
    const g = auraGrid(0, 0);
    expect(g.gw).toBeGreaterThanOrEqual(1);
    expect(g.gh).toBeGreaterThanOrEqual(1);
  });

  it("幅広ほどセル数が増える（単調非減少）・決定的", () => {
    expect(auraGrid(800, 200, 8).gw).toBeGreaterThan(auraGrid(400, 200, 8).gw);
    expect(auraGrid(500, 300)).toEqual(auraGrid(500, 300));
  });
});

describe("auraBotFade（G-TC-160・下辺の可読性フェード）", () => {
  it("最下行付近（gy>=botRow）は控えめ 0.32／それ以外は 1", () => {
    const botRow = 20;
    expect(auraBotFade(botRow, botRow)).toBe(0.32);
    expect(auraBotFade(botRow + 3, botRow)).toBe(0.32);
    expect(auraBotFade(botRow - 1, botRow)).toBe(1);
    expect(auraBotFade(0, botRow)).toBe(1);
  });

  it("0 より大きく 1 以下（文字が完全には消えない）・決定的", () => {
    for (const gy of [0, 10, 20, 25]) { const v = auraBotFade(gy, 20); expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); }
    expect(auraBotFade(21, 20)).toBe(auraBotFade(21, 20));
  });
});
