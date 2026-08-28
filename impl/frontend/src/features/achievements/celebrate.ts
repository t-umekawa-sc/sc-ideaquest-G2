// 実績アンロック祝福の純ロジック（SC-40・ゲーム感 #6）。視覚は AchievementCelebration／CSS 側。
// 前回このブラウザで観測した「獲得済み実績 id 群」（localStorage・アカウント別）と現在の獲得済み id 群を
// 比べ、新規に解放された id を返す。#2 レベルアップ（features/dashboard/levelup.ts）と同型。

const KEY_PREFIX = "iq:seenAch:";

export function achStorageKey(accountId: string): string {
  return KEY_PREFIX + accountId;
}

/** localStorage の生値（JSON 文字列配列）を id 群へ。未記録/非配列/壊れ JSON は null（＝初回観測扱い）。 */
export function parseSeenCodes(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

/**
 * 祝福すべき（新規解放された）id 群を返す。
 * - prevSeen === null（初回観測）＝空配列（記録だけ・誤発火防止＝既存の獲得を一斉に祝福しない）
 * - それ以外＝current のうち prevSeen に無い id（順序は current のまま）
 */
export function shouldCelebrateUnlock(prevSeen: string[] | null, currentUnlocked: string[]): string[] {
  if (prevSeen === null) return [];
  const seen = new Set(prevSeen);
  return currentUnlocked.filter((c) => !seen.has(c));
}

/** 記録すべき最新の獲得済み id 群（prev∪current の重複除去）。実績は失われない前提で減らさない。 */
export function nextStoredCodes(prevSeen: string[] | null, currentUnlocked: string[]): string[] {
  const set = new Set<string>(prevSeen ?? []);
  for (const c of currentUnlocked) set.add(c);
  return Array.from(set);
}
