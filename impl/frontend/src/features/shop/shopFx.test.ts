// G-TC-165（unit/front）＝ショップ購入「支払い」演出の純ロジック（doc/テスト/G_ゲーミフィケーション.md）。
// 受入済みモック（style-guide.html §17M）＝価格が price→0 まで減って支払い完了→所有UIへ。
// canvas/DOM 駆動（コイン落下・カウンタ弾み・所有遷移・紙吹雪/お礼）は GF-AC ブラウザ受入に委ね、
// 決定的に抽出できる「カウントダウンの表示値列」と「reduce 分岐」のみ unit で担保する（記憶 animation-reduce-motion-standard）。
import { describe, expect, it } from "vitest";

import { PAY_STEPS, payValues, planBuyFx } from "./shopFx";

describe("shopFx.payValues（支払いカウントダウンの表示値列）", () => {
  it("既定ステップ数の値列で、末尾は 0・単調非増加・全て [0,price]", () => {
    const price = 120;
    const seq = payValues(price);
    expect(seq).toHaveLength(PAY_STEPS);
    expect(seq[seq.length - 1]).toBe(0); // 0 で支払い完了
    expect(seq[0]).toBeLessThan(price); // 最初のステップで既に減っている
    for (let i = 0; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThanOrEqual(0);
      expect(seq[i]).toBeLessThanOrEqual(price);
      if (i > 0) expect(seq[i]).toBeLessThanOrEqual(seq[i - 1]); // 単調非増加
    }
  });

  it("価格 0 や小さな価格でも末尾 0・長さ一定（決定的）", () => {
    expect(payValues(0)).toEqual(new Array(PAY_STEPS).fill(0));
    const seq = payValues(3);
    expect(seq).toHaveLength(PAY_STEPS);
    expect(seq[seq.length - 1]).toBe(0);
    expect(payValues(120)).toEqual(payValues(120)); // 同入力は同出力
  });
});

describe("shopFx.planBuyFx（reduce 分岐）", () => {
  it("実効抑制なら static（演出を出さず即・所有UI＝情報は残す）／非抑制は animate", () => {
    expect(planBuyFx(true)).toBe("static");
    expect(planBuyFx(false)).toBe("animate");
  });
});
