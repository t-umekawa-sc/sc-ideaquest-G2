// SC-24 引用ジャンプの純ロジック（受入不具合 DFT-E-006）＝
// ①ジャンプ先がフローティング文脈バー（.chat-context--float）に隠れないよう着地位置を計算、
// ②「どこへ飛んだか」を示すハイライトのクラスを選ぶ（モーション抑制を尊重）。
// DOM 副作用は IdeaChatView 側。ここは単体テスト可能な純関数のみ（正＝doc/テスト/E_チャット.md E-TC-214）。

/**
 * 引用元メッセージの絶対スクロール位置＝フローティングバー下端＋gap の直下に着地させる。
 * @param elViewportTop 引用元 el の getBoundingClientRect().top（ビューポート基準）
 * @param scrollY       現在の window.scrollY
 * @param barBottom     フローティング文脈バーの getBoundingClientRect().bottom（無ければヘッダー下端）
 * @param gap           バー下端との余白
 * @returns 目標 scrollTop（負値は 0 にクランプ）
 */
export function scrollTopForTarget(
  elViewportTop: number,
  scrollY: number,
  barBottom: number,
  gap: number,
): number {
  return Math.max(0, scrollY + elViewportTop - barBottom - gap);
}

/** ジャンプ先ハイライトのクラス。抑制時は動きの無い静止ハイライト（機能＝ジャンプ先の判別は維持）。 */
export function flashClassFor(reduce: boolean): "msg--flash" | "msg--flash-static" {
  return reduce ? "msg--flash-static" : "msg--flash";
}
