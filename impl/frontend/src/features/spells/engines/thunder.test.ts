// G-TC-157: 雷 canvas エンジンの決定的部分（解像度／発雷フラッシュの水平減衰）。
// canvas 本体（ジグザグ稲妻・枝分かれ・枠線ビリビリ・着弾粒子＝rng spawn・rAF 駆動）は非決定的なので GF-AC 受入に委ね、
// ここでは決定的に抽出した thunderGrid（ドット絵解像度）と flashBand（発雷グローの水平減衰＝可読性）のみ担保する。
import { describe, it, expect } from "vitest";
import { thunderGrid, flashBand } from "./thunder";

describe("thunderGrid（G-TC-157・実寸→低解像度グリッド）", () => {
  it("cols/rows は整数で下限 140×20 にクランプされる", () => {
    const g = thunderGrid(0, 0);
    expect(Number.isInteger(g.cols)).toBe(true);
    expect(Number.isInteger(g.rows)).toBe(true);
    expect(g.cols).toBeGreaterThanOrEqual(140);
    expect(g.rows).toBeGreaterThanOrEqual(20);
  });

  it("十分大きい実寸では cols≈round(w/scale)（幅広ほどセル数が増える・単調非減少）", () => {
    const scale = 3;
    const narrow = thunderGrid(600, 120, scale);
    const wide = thunderGrid(1200, 120, scale);
    expect(narrow.cols).toBe(Math.round(600 / scale));
    expect(wide.cols).toBe(Math.round(1200 / scale));
    expect(wide.cols).toBeGreaterThan(narrow.cols);
    expect(thunderGrid(600, 300, scale).rows).toBe(Math.round(300 / scale));
  });

  it("決定的（同じ入力は同じ出力）", () => {
    expect(thunderGrid(1000, 200)).toEqual(thunderGrid(1000, 200));
  });
});

describe("flashBand（G-TC-157・発雷フラッシュの水平減衰：中央明→端暗）", () => {
  it("中央 x=w/2 で最大 1", () => {
    expect(flashBand(120, 240)).toBeCloseTo(1, 9);
    expect(flashBand(300, 600)).toBeCloseTo(1, 9);
  });

  it("中央から離れるほど単調非増加", () => {
    const w = 240;
    let prev = flashBand(w / 2, w);
    for (let d = 1; d <= w / 2; d++) {
      const cur = flashBand(w / 2 + d, w);
      expect(cur).toBeLessThanOrEqual(prev + 1e-9);
      prev = cur;
    }
  });

  it("0 未満にならない（範囲外 x でもクランプ）", () => {
    for (let x = -200; x <= 440; x++) expect(flashBand(x, 240)).toBeGreaterThanOrEqual(0);
  });

  it("決定的（同じ入力は同じ出力）", () => {
    expect(flashBand(60, 240)).toBe(flashBand(60, 240));
  });
});
