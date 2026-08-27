"use client";

// レベルアップ祝福オーバーレイ（SC-01・ゲーム感）。前回観測レベル（localStorage・アカウント別）より
// 現在レベルが上がっていたら中央に祝福を出し ~2.6s で自動消滅。reduced-motion では静的表示（演出なし）。
import { useEffect, useRef, useState } from "react";

import {
  levelStorageKey,
  nextStoredLevel,
  parseSeenLevel,
  shouldCelebrateLevelUp,
} from "../levelup";

export function LevelUpWatcher({ accountId, level }: { accountId: string; level: number }) {
  const [shownLevel, setShownLevel] = useState<number | null>(null);
  const handled = useRef(false); // 初回の localStorage 照合は1度だけ（level 再取得での多重発火防止）

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    let prev: number | null = null;
    try {
      const key = levelStorageKey(accountId);
      prev = parseSeenLevel(localStorage.getItem(key));
      localStorage.setItem(key, String(nextStoredLevel(prev, level)));
    } catch {
      return; // localStorage 不可（プライベート等）は演出せず素通し
    }
    if (shouldCelebrateLevelUp(prev, level)) setShownLevel(level);
  }, [accountId, level]);

  useEffect(() => {
    if (shownLevel === null) return;
    const t = setTimeout(() => setShownLevel(null), 2600);
    return () => clearTimeout(t);
  }, [shownLevel]);

  if (shownLevel === null) return null;

  return (
    <div className="levelup-overlay" role="status" aria-live="polite" onClick={() => setShownLevel(null)}>
      <div className="levelup-card">
        <div className="levelup-aura" aria-hidden />
        <div className="levelup-spark levelup-spark--a" aria-hidden>✦</div>
        <div className="levelup-spark levelup-spark--b" aria-hidden>✧</div>
        <div className="levelup-spark levelup-spark--c" aria-hidden>★</div>
        <div className="levelup-title">LEVEL UP!</div>
        <div className="levelup-lv">Lv.{shownLevel}</div>
        <div className="levelup-sub">スキルポイント +1</div>
      </div>
    </div>
  );
}
