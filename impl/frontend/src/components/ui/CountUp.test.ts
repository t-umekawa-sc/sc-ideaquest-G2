// I-TC-150: カウントアップの1フレーム値（純関数・SC-01 ヒーロー演出）。
// 視覚（充填の見た目）はブラウザ受入。ここは端点・単調・easeOutCubic を固定する。
import { describe, expect, it } from "vitest";

import { countUpFrame } from "./CountUp";

describe("countUpFrame (I-TC-150)", () => {
  it("端点は厳密（t=0→from・t=1→to）", () => {
    expect(countUpFrame(10, 250, 0)).toBe(10);
    expect(countUpFrame(10, 250, 1)).toBe(250);
  });

  it("範囲外の t はクランプ（<0→from・>1→to）", () => {
    expect(countUpFrame(10, 250, -0.5)).toBe(10);
    expect(countUpFrame(10, 250, 1.5)).toBe(250);
  });

  it("t=0.5 は easeOutCubic（eased=0.875）", () => {
    // 1-(1-0.5)^3 = 0.875 → round(0 + 100*0.875) = 88
    expect(countUpFrame(0, 100, 0.5)).toBe(88);
  });

  it("0<t<1 で単調非減少", () => {
    let prev = countUpFrame(0, 1000, 0);
    for (let i = 1; i <= 10; i++) {
      const cur = countUpFrame(0, 1000, i / 10);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it("減少方向（from>to）でも端点厳密・単調非増加", () => {
    expect(countUpFrame(200, 50, 0)).toBe(200);
    expect(countUpFrame(200, 50, 1)).toBe(50);
    expect(countUpFrame(200, 50, 0.5)).toBe(200 + Math.round((50 - 200) * 0.875)); // 69
  });
});
