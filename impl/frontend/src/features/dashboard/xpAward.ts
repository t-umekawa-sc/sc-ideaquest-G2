// 投票の獲得 XP フィードバックの純ロジック（SC-01・ゲーム感 #8・段階ハイブリッド step1）。
// 視覚は XpFloat／ヒーロー XP バー（DashboardView）。金額の正は最終的に backend delta へ寄せる方針で、
// 当面は仕様固定 +5 を frontend 定数で持つ（暫定・backend delta 移行で解消）。

// 投票の初回付与 XP（仕様固定・D 台帳 vote=+5／日次上限は server の xp_awarded でゲート）。
export const VOTE_XP = 5;

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
