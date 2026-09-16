"use client";
// 一覧のスクロール位置復元（デザイン標準 §4.12・横断標準）。
// 方式＝restore-after-load＝クライアント取得で mount 直後は空（低い）ため、標準の戻る復元は
// 効かない。そこで「data 描画が終わった（ready）後に1回だけ window.scrollTo」で復元する。
// 保存は sessionStorage（同一セッション限定）＋30分TTL＋[0,maxScroll] クランプ。
import { useEffect, useLayoutEffect, useRef } from "react";

import { usePathname } from "next/navigation";

const TTL_MS = 30 * 60 * 1000; // 30分：古い位置は誤復元しない
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// sessionStorage のキー＝ルート（pathname）で名前空間化。
export function storageKey(key: string): string {
  return `scroll:${key}`;
}

// 復元先を [0, max] に収める（戻り先が縮んでも先頭に飛ばさない）。
export function clampScroll(y: number, max: number): number {
  return Math.max(0, Math.min(y, max));
}

// 保存済み JSON を検証して y を返す。TTL 超過・欠損・壊れ・非数値は null（誤復元しない）。
export function readSaved(raw: string | null, now: number, ttlMs: number): number | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { y?: unknown; t?: unknown };
    if (typeof o.y !== "number" || !Number.isFinite(o.y)) return null;
    if (typeof o.t !== "number") return null;
    if (now - o.t > ttlMs) return null;
    return o.y;
  } catch {
    return null;
  }
}

/**
 * 一覧/ダッシュボードのスクロール位置を復元する横断フック（§4.12）。
 * @param ready コンテンツが実寸になったか（ダッシュボード＝`data!==null`／通知一覧＝`!loading`）。
 * @param key   sessionStorage キー（既定＝現在の pathname）。同一ルートに戻ったときだけ復元。
 */
export function useScrollRestore(ready: boolean, key?: string): void {
  const pathname = usePathname();
  const k = key ?? pathname ?? "/";
  const restoredRef = useRef(false);

  // 保存＝スクロール中に rAF スロットルで sessionStorage へ。
  // ただし遷移時はページが先頭(0)へリセットされ、その scroll がラストの良い値(例2521)を 0 で潰す。
  // そこで**クリック時点（遷移リセット前）の位置を確定保存**し、直後の一定時間はリセット由来の保存を抑止する。
  // （push=`<Link href="/">` でも pop=back でも、離脱直前の位置が残る）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    let suppressUntil = 0; // この時刻まではスクロール保存を抑止（遷移リセットの 0 を書かない）
    const save = () => {
      try {
        sessionStorage.setItem(storageKey(k), JSON.stringify({ y: window.scrollY, t: Date.now() }));
      } catch {
        /* storage 不可（プライベート等）は無視 */
      }
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (Date.now() < suppressUntil) return; // 遷移リセット中は保存しない
        save();
      });
    };
    const onClickCapture = () => {
      // クリック（＝多くの遷移の起点）時点の位置を先に確定保存し、直後のリセット scroll を抑止する。
      suppressUntil = Date.now() + 800;
      save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClickCapture, true);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [k]);

  // 復元＝ready（コンテンツ実寸）後に1回だけ・瞬間移動（§4.9 抑制対象外）。
  useIsoLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    if (typeof window === "undefined") return;
    restoredRef.current = true;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(storageKey(k));
    } catch {
      raw = null;
    }
    const saved = readSaved(raw, Date.now(), TTL_MS);
    if (saved == null) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: clampScroll(saved, max), behavior: "auto" });
  }, [ready, k]);
}
