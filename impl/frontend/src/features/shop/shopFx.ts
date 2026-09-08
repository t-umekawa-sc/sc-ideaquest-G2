// SC-30 ショップ購入の演出（ゲーム感 #12）＝受入済みモック（doc/画面設計/mocks/style-guide.html §17M）の純ロジック分。
// 演出＝右上（財布）から ◆ コインが価格へ降りて吸い込まれ、価格が price→0 と減って支払い完了→コインはサムネ左上バッジへ移り、
// 価格行は「✓ 所有済み」、フットは「▶ きせかえで装備」へ（金地/リボン/光沢/紙吹雪＋「〈名〉を手に入れた」）。
// canvas/DOM 駆動（コイン落下・カウンタ弾み・所有遷移・祝福/お礼）は GF-AC ブラウザ受入に委ね、
// 決定的に抽出できる「カウントダウンの表示値列」と「reduce 分岐」のみ純関数として切り出す（G-TC-165）。

export const PAY_MS = 900; // 価格が 0 に達するまで
export const PAY_STEPS = 18; // カウントダウンの刻み数

/** 支払いカウントダウンの各ステップで表示するコイン数（price→0・単調非増加・末尾 0）。純関数（決定的）。 */
export function payValues(price: number, steps: number = PAY_STEPS): number[] {
  const out: number[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push(i >= steps ? 0 : Math.max(0, Math.round(price * (1 - i / steps))));
  }
  return out;
}

/** 実効抑制（reduceMotion()＝OS reduce OR accounts.reduce_motion）なら演出を出さず即・所有UI（情報は残す）。 */
export function planBuyFx(reduce: boolean): "static" | "animate" {
  return reduce ? "static" : "animate";
}
