// G-TC-159: 虹 canvas エンジンの決定的部分（散布ターゲット／チャージ量）。
// canvas 本体（虹ビーム/飛散/ゆらゆら集結/エネルギー球チャージ/再発射＝rng・rAF 駆動）は §17L-f2／実アプリの
// GF-AC ブラウザ受入に委ね、決定的に抽出した rainbowScatterTargets（満遍ない飛散先）と
// rainbowChargeGrow（集結数に比例するエネルギー球サイズ）のみ担保する。
import { describe, it, expect } from "vitest";
import { rainbowScatterTargets, rainbowChargeGrow } from "./rainbow";

// 決定的な擬似乱数（seed 付き mulberry32）＝同 seed で同列。
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe("rainbowScatterTargets（G-TC-159・満遍ない飛散先）", () => {
  it("n 個返し、すべてパッド内 [pad, w-pad]×[pad, h-pad] に収まる", () => {
    const w = 380, h = 170, pad = 21, n = 28;
    const ts = rainbowScatterTargets(w, h, pad, n, seeded(1));
    expect(ts).toHaveLength(n);
    for (const t of ts) {
      expect(t.x).toBeGreaterThanOrEqual(pad);
      expect(t.x).toBeLessThanOrEqual(w - pad);
      expect(t.y).toBeGreaterThanOrEqual(pad);
      expect(t.y).toBeLessThanOrEqual(h - pad);
    }
  });

  it("決定的（同 seed は同じ列・違う seed は異なる）", () => {
    const args = [380, 170, 21, 10] as const;
    expect(rainbowScatterTargets(...args, seeded(7))).toEqual(rainbowScatterTargets(...args, seeded(7)));
    expect(rainbowScatterTargets(...args, seeded(7))).not.toEqual(rainbowScatterTargets(...args, seeded(8)));
  });

  it("パッドが広く span が負でも下限0でクランプ（pad に張り付く・範囲外を返さない）", () => {
    const ts = rainbowScatterTargets(40, 40, 30, 5, seeded(3)); // 2*pad>w → span=0
    for (const t of ts) { expect(t.x).toBe(30); expect(t.y).toBe(30); }
  });
});

describe("rainbowChargeGrow（G-TC-159・集結数に比例するエネルギー球）", () => {
  it("n=0 は 0（球を描かない）", () => { expect(rainbowChargeGrow(0)).toBe(0); expect(rainbowChargeGrow(-3)).toBe(0); });

  it("n が増えるほど単調増加（集まるほど強まる）", () => {
    let prev = rainbowChargeGrow(1);
    for (let n = 2; n <= 30; n++) { const cur = rainbowChargeGrow(n); expect(cur).toBeGreaterThan(prev); prev = cur; }
  });

  it("決定的（同じ入力は同じ出力）", () => { expect(rainbowChargeGrow(12)).toBe(rainbowChargeGrow(12)); });
});
