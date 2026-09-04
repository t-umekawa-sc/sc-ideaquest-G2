// G-TC-155: canvas エンジンの決定的部分（スプライトのデコード／UFO のパターン別軌道）。
// canvas 本体（描画/rAF/乱数 spawn）は非決定的なので GF-AC 受入に委ね、ここでは決定的な純ロジックのみ担保。
import { describe, it, expect } from "vitest";
import { decodeSprite, ufoPosition, UFO_ART, UFO_COL, type UfoParams } from "./sprites";

describe("decodeSprite（G-TC-155・ドット絵スプライトのデコード）", () => {
  const cells = decodeSprite(UFO_ART, UFO_COL);

  it("'.'（透過）は出力に含めない", () => {
    // 非透過セルの合計＝各行の非'.'数の総和。UFO_ART は既知の固定スプライト。
    const expected = UFO_ART.reduce((sum, row) => sum + [...row].filter((c) => c !== ".").length, 0);
    expect(cells.length).toBe(expected);
    expect(expected).toBe(76); // 固定値（15×8 のうち 76 セルが非透過）
  });

  it("各セルは行内 x・行 y を正しく持つ（範囲内・整数）", () => {
    for (const c of cells) {
      expect(Number.isInteger(c.x)).toBe(true);
      expect(Number.isInteger(c.y)).toBe(true);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(UFO_ART[0].length);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(UFO_ART.length);
      // 元のスプライトの該当セルと char が一致
      expect(UFO_ART[c.y].charAt(c.x)).toBe(c.char);
    }
  });

  it("colMap にある文字は色解決・未知文字（L=点滅ライト）は色 null で char を保持", () => {
    const lights = cells.filter((c) => c.char === "L");
    expect(lights.length).toBe(4); // BLBBBLBBBLBBBLB ＝ 4 個
    for (const c of lights) expect(c.color).toBeNull();
    const colored = cells.filter((c) => c.char !== "L");
    for (const c of colored) expect(c.color).toBe(UFO_COL[c.char]);
  });

  it("決定的（同じ入力で同じ出力）", () => {
    expect(decodeSprite(UFO_ART, UFO_COL)).toEqual(cells);
  });
});

describe("ufoPosition（G-TC-155・UFO のパターン別軌道）", () => {
  const p: UfoParams = { x0: -30, x1: 130, yBase: 20, amp: 10, freq: 3, H: 100 };

  it("全 pat で prog=0→x=x0・prog=1→x=x1（pat7 のループ区間 0.4..0.6 を除く両端）", () => {
    for (let pat = 0; pat <= 9; pat++) {
      expect(ufoPosition(pat, 0, p).x).toBeCloseTo(p.x0, 6);
      expect(ufoPosition(pat, 1, p).x).toBeCloseTo(p.x1, 6);
    }
  });

  it("pat0 は常に y=yBase（直線）", () => {
    for (const prog of [0, 0.25, 0.5, 0.75, 1]) {
      expect(ufoPosition(0, prog, p).y).toBeCloseTo(p.yBase, 6);
    }
  });

  it("pat2 は中央で下ディップ（y>yBase）・pat3 は上山（y<yBase）で符号が反対", () => {
    expect(ufoPosition(2, 0.5, p).y).toBeGreaterThan(p.yBase);
    expect(ufoPosition(3, 0.5, p).y).toBeLessThan(p.yBase);
  });

  it("x,y は有限値（全 pat・複数 prog）", () => {
    for (let pat = 0; pat <= 9; pat++) {
      for (const prog of [0, 0.3, 0.5, 0.7, 1]) {
        const { x, y } = ufoPosition(pat, prog, p);
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });
});
