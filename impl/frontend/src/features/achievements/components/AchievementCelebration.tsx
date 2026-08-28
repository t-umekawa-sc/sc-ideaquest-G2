"use client";

// 実績アンロック祝福オーバーレイ（SC-40・ゲーム感 #6）。前回観測した獲得 id 群（localStorage・アカウント別）より
// 新規に解放された実績を中央に祝福し ~3.2s で自動消滅。複数同時解放はまとめて表示。
// reduced-motion では静的表示（演出なし）。純ロジックは ../celebrate（G-TC-150）。
import { useEffect, useRef, useState } from "react";

import { achStorageKey, nextStoredCodes, parseSeenCodes, shouldCelebrateUnlock } from "../celebrate";

export type UnlockedAch = { id: string; name: string; icon: string };

export function AchievementCelebration({
  accountId,
  unlocked,
  ready,
}: {
  accountId: string;
  unlocked: UnlockedAch[];
  ready: boolean;
}) {
  const [shown, setShown] = useState<UnlockedAch[]>([]);
  const handled = useRef(false); // 観測照合は読み込み完了後に1度だけ（load 前の空集合で記録しない）

  useEffect(() => {
    if (!ready || handled.current) return;
    handled.current = true;
    const codes = unlocked.map((a) => a.id);
    let prev: string[] | null = null;
    try {
      const key = achStorageKey(accountId);
      prev = parseSeenCodes(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify(nextStoredCodes(prev, codes)));
    } catch {
      return; // localStorage 不可（プライベート等）は演出せず素通し
    }
    const freshIds = new Set(shouldCelebrateUnlock(prev, codes));
    if (freshIds.size > 0) setShown(unlocked.filter((a) => freshIds.has(a.id)));
  }, [accountId, unlocked, ready]);

  useEffect(() => {
    if (shown.length === 0) return;
    const t = setTimeout(() => setShown([]), 3200);
    return () => clearTimeout(t);
  }, [shown]);

  if (shown.length === 0) return null;

  return (
    <div className="ach-unlock-overlay" role="status" aria-live="polite" onClick={() => setShown([])}>
      <div className="ach-unlock-card">
        <div className="ach-unlock-aura" aria-hidden />
        <div className="ach-unlock-spark ach-unlock-spark--a" aria-hidden>✦</div>
        <div className="ach-unlock-spark ach-unlock-spark--b" aria-hidden>✧</div>
        <div className="ach-unlock-spark ach-unlock-spark--c" aria-hidden>★</div>
        <div className="ach-unlock-title">ACHIEVEMENT UNLOCKED!</div>
        <ul className="ach-unlock-list">
          {shown.map((a) => (
            <li key={a.id} className="ach-unlock-item">
              <span className="ach-unlock-medal" aria-hidden>{a.icon}</span>
              <span className="ach-unlock-name">{a.name}</span>
            </li>
          ))}
        </ul>
        <div className="ach-unlock-sub">実績を獲得しました</div>
      </div>
    </div>
  );
}
