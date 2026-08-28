// 投票の獲得 XP フィードバックの純ロジック（SC-01・ゲーム感 #8）。
// 視覚は XpFloat／ヒーロー XP バー（DashboardView）。金額は server の応答 `xp_delta` が正
// （step2 で backend delta に一本化＝frontend 定数は撤去済み）。ここは表示用のバー％計算のみを担う。

/**
 * 楽観的に前進させた XP バーの充填％（現レベル内）。
 * - 合算 xpInLevel+bump を 0..levelSpan にクランプ（レベルアップは詐称しない＝最大 100%）
 * - levelSpan<=0 は 0
 */
export function bumpedXpPct(xpInLevel: number, levelSpan: number, bump: number): number {
  if (levelSpan <= 0) return 0;
  const v = Math.min(levelSpan, Math.max(0, xpInLevel + bump));
  return Math.round((v / levelSpan) * 100);
}
