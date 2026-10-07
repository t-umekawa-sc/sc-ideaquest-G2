// 一覧の列見出しフローティング（DataTable floatHead・デザイン標準 §4.5/§4.10）で、上部に固定表示中の
// sticky バー（タブ .tabs・文脈バナー .ctx 等）の「下」へ見出しを潜り込ませる純ロジック（DRY・単体テスト可能）。
// 画面上部に張り付いている（＝現在の固定 top の高さに重なっている）バーだけを対象にし、その下端＋余白を返す。

export type BarRect = { top: number; bottom: number } | null | undefined;

/**
 * 固定表示中の sticky バーの下端まで見出し top を下げる。
 * - バーが無い／張り付いていない（固定 top 位置に重なっていない）時は `top` をそのまま返す（無影響）。
 * - 「張り付いている」判定＝`rect.bottom > top`（バー下端が固定位置より下にある）かつ `rect.top <= top + 4`
 *   （バー上端が固定位置付近まで来ている＝スクロールで上に流れきっていない）。
 * @param top  現在の固定 top（px）
 * @param rect バーの getBoundingClientRect（null 可）
 * @param gap  下端に足す余白（px・既定0）
 */
export function belowStuckBar(top: number, rect: BarRect, gap = 0): number {
  if (!rect) return top;
  if (rect.bottom > top && rect.top <= top + 4) return rect.bottom + gap;
  return top;
}
