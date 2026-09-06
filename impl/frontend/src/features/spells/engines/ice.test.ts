// G-TC-158: 氷 canvas エンジンの決定的部分（解像度／霜の可読性フェード）。
// canvas 本体（Voronoi 凍結・氷柱の生成/破砕・ピカッ連鎖・雪/破片＝rng・rAF 駆動）は非決定的なので GF-AC 受入に委ね、
// ここでは決定的に抽出した iceGrid（ドット絵解像度）と frostAlpha（霜フィルの可読性フェード）のみ担保する。
import { describe, it, expect } from "vitest";
import { iceGrid, frostAlpha } from "./ice";

describe("iceGrid（G-TC-158・実寸→低解像度グリッド）", () => {
  it("cols/rows は整数で下限 140×20 にクランプされる", () => {
    const g = iceGrid(0, 0);
    expect(Number.isInteger(g.cols)).toBe(true);
    expect(Number.isInteger(g.rows)).toBe(true);
    expect(g.cols).toBeGreaterThanOrEqual(140);
    expect(g.rows).toBeGreaterThanOrEqual(20);
  });

  it("十分大きい実寸では cols≈round(w/scale)（幅広ほどセル数が増える・単調非減少）", () => {
    const scale = 3;
    const narrow = iceGrid(600, 120, scale);
    const wide = iceGrid(1200, 120, scale);
    expect(narrow.cols).toBe(Math.round(600 / scale));
    expect(wide.cols).toBe(Math.round(1200 / scale));
    expect(wide.cols).toBeGreaterThan(narrow.cols);
    expect(iceGrid(600, 300, scale).rows).toBe(Math.round(300 / scale));
  });

  it("決定的（同じ入力は同じ出力）", () => {
    expect(iceGrid(1000, 200)).toEqual(iceGrid(1000, 200));
  });
});

describe("frostAlpha（G-TC-158・霜フィルの可読性フェード）", () => {
  it("bright が増えるほど単調非減少", () => {
    let prev = frostAlpha(0, 1);
    for (let b = 0; b <= 1.0001; b += 0.1) {
      const cur = frostAlpha(Math.min(1, b), 1);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
  });

  it("settle が下がるほど薄くなる（単調非減少＝全面凍結後は薄い）", () => {
    // settle 1（凍結直後）は最も濃く、settle 0.6（落ち着き後）は薄い。
    expect(frostAlpha(0.5, 1)).toBeGreaterThanOrEqual(frostAlpha(0.5, 0.6) - 1e-9);
    expect(frostAlpha(1, 1)).toBeGreaterThan(frostAlpha(1, 0.6));
  });

  it("0 未満にならない", () => {
    for (let b = 0; b <= 1; b += 0.25) for (const s of [0.6, 0.8, 1]) expect(frostAlpha(b, s)).toBeGreaterThanOrEqual(0);
  });

  it("決定的（同じ入力は同じ出力）", () => {
    expect(frostAlpha(0.7, 0.8)).toBe(frostAlpha(0.7, 0.8));
  });
});
