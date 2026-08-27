// レベルアップ演出の純ロジック（SC-01・ゲーム感）。視覚は LevelUpWatcher／CSS 側。
// 前回このブラウザで観測したレベル（localStorage・アカウント別）と現在値を比べて祝福可否を決める。

const KEY_PREFIX = "iq:lastSeenLevel:";

export function levelStorageKey(accountId: string): string {
  return KEY_PREFIX + accountId;
}

/** localStorage の生値をレベル（数値）へ。未記録/不正は null（＝初回観測扱い）。 */
export function parseSeenLevel(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/**
 * 祝福すべきか（現在レベルが前回観測より上がったか）。
 * - prevSeen === null（初回観測）＝祝福しない（記録だけ・誤発火防止）
 * - current > prevSeen ＝祝福する
 * - それ以外（同値/低下）＝祝福しない
 */
export function shouldCelebrateLevelUp(prevSeen: number | null, current: number): boolean {
  if (prevSeen === null) return false;
  return current > prevSeen;
}

/** 記録すべき最新レベル（初回は current・上がったら current・下がっても current で追随＝古い値で固まらない）。 */
export function nextStoredLevel(prevSeen: number | null, current: number): number {
  if (prevSeen === null) return current;
  return current !== prevSeen ? current : prevSeen;
}
