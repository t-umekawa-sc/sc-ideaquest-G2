import { describe, expect, it } from "vitest";

import { flashClassFor, scrollTopForTarget } from "./jump";

// E-TC-214: 引用ジャンプの着地位置計算＋ハイライトクラス選択（受入不具合 DFT-E-006 再発防止）。
// 正＝doc/テスト/E_チャット.md E-TC-214。
describe("scrollTopForTarget（引用ジャンプ着地位置）", () => {
  it("バー下端＋gap の直下に着地する（scrollY+elTop-barBottom-gap）", () => {
    // el がビューポート上 200px・現在 scrollY 500・フローティングバー下端 120・余白 8
    expect(scrollTopForTarget(200, 500, 120, 8)).toBe(572);
  });

  it("上方向へのジャンプでも同式（絶対位置で解決）", () => {
    // el がビューポート上端より上（負値）＝上に戻るジャンプ
    expect(scrollTopForTarget(-300, 500, 120, 8)).toBe(72);
  });

  it("最上部近傍は 0 にクランプ（負のスクロール位置を作らない）", () => {
    expect(scrollTopForTarget(50, 0, 120, 8)).toBe(0);
  });
});

describe("flashClassFor（ジャンプ先ハイライトのクラス選択）", () => {
  it("通常＝アニメ付きハイライト", () => {
    expect(flashClassFor(false)).toBe("msg--flash");
  });

  it("モーション抑制時＝静止ハイライト（動きなし・機能は維持）", () => {
    expect(flashClassFor(true)).toBe("msg--flash-static");
  });
});
