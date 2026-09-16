"use client";
// 一覧のスクロール位置復元（デザイン標準 §4.12・横断標準）。
// 方式＝restore-after-load＝クライアント取得で mount 直後は空（低い）ため、標準の戻る復元は
// 効かない。そこで「保存位置を初回レンダーで確定キャプチャ → data 描画（ready）後に復元」する。
// - 保存は sessionStorage（同一セッション限定）＋30分TTL＋[0,maxScroll] クランプ。
// - **キャプチャの要**＝pop 帰還（router.back）では Next のネイティブ復元が古い位置（0/81 等）へ飛ばし、
//   その scroll を onScroll が保存して良い値を潰す。これを避けるため、保存値は**初回レンダー時**
//   （scroll リスナ装着＝onScroll 保存が起きる前）に読み取り ref に確定する。
// - 復元は HOLD_MS だけ毎フレーム再適用し、Next ネイティブ復元・遅延レイアウトを上書き（ユーザー操作で即中断）。
import { useEffect, useLayoutEffect, useRef } from "react";

import { usePathname } from "next/navigation";

const TTL_MS = 30 * 60 * 1000; // 30分：古い位置は誤復元しない
const HOLD_MS = 500; // 復元位置を保持して競合（Next ネイティブ復元・遅延レイアウト）を上書きする窓
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

// 現在の保存位置（TTL 内）を読む。無ければ null。
function readTarget(k: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    return readSaved(sessionStorage.getItem(storageKey(k)), Date.now(), TTL_MS);
  } catch {
    return null;
  }
}

// 保存位置へ HOLD_MS の間だけ毎フレーム再適用する（Next のネイティブ pop 復元や遅延レイアウトを上書き）。
// ユーザーの操作（ホイール/タッチ/キー/ポインタ）で即中断＝ユーザーのスクロールと喧嘩しない。
// 戻り値＝キャンセル関数（アンマウント/再適用の差し替えで呼ぶ＝別ページへ scrollTo が漏れるのを防ぐ）。
function reapplyScroll(saved: number | null): () => void {
  if (typeof window === "undefined" || saved == null) return () => {};
  let cancelled = false;
  let raf = 0;
  const start = Date.now();
  const cleanup = () => {
    cancelled = true;
    if (raf) window.cancelAnimationFrame(raf);
    window.removeEventListener("wheel", onUser);
    window.removeEventListener("touchstart", onUser);
    window.removeEventListener("keydown", onUser);
    window.removeEventListener("pointerdown", onUser);
  };
  const onUser = () => cleanup();
  const tick = () => {
    if (cancelled) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: clampScroll(saved, max), behavior: "auto" });
    if (Date.now() - start < HOLD_MS) raf = window.requestAnimationFrame(tick);
    else cleanup();
  };
  window.addEventListener("wheel", onUser, { passive: true });
  window.addEventListener("touchstart", onUser, { passive: true });
  window.addEventListener("keydown", onUser);
  window.addEventListener("pointerdown", onUser, { passive: true });
  tick();
  return cleanup;
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
  const cancelRef = useRef<null | (() => void)>(null);

  // 初回レンダーで保存位置を確定キャプチャ（onScroll 保存が Next ネイティブ復元の値で潰す前に掴む）。
  const targetRef = useRef<{ k: string; y: number | null } | null>(null);
  if (!targetRef.current || targetRef.current.k !== k) {
    targetRef.current = { k, y: readTarget(k) };
  }

  // 保存＝スクロール中に rAF スロットルで sessionStorage へ。
  // ただし遷移時はページが先頭(0)へリセットされ、その scroll がラストの良い値を 0 で潰す。
  // そこで**クリック時点（遷移リセット前）の位置を確定保存**し、直後の一定時間はリセット由来の保存を抑止する。
  // 併せて popstate（戻る/進む）でこのページに帰還したら保存位置へ再適用する（ページ再利用で再マウントしない場合の保険）。
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
    const onPop = () => {
      // 戻る/進むでこのルートに帰還（かつ再マウントしない）場合の保険＝保存位置へ再適用。
      if (window.location.pathname !== k) return;
      cancelRef.current?.();
      cancelRef.current = reapplyScroll(readTarget(k));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClickCapture, true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("popstate", onPop);
      if (raf) window.cancelAnimationFrame(raf);
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [k]);

  // 初回マウント（push/pop 帰還とも再マウント時）＝ready（コンテンツ実寸）後に1回・**キャプチャ済み**の位置へ復元。
  useIsoLayoutEffect(() => {
    if (!ready || restoredRef.current) return;
    if (typeof window === "undefined") return;
    restoredRef.current = true;
    cancelRef.current?.();
    cancelRef.current = reapplyScroll(targetRef.current?.y ?? null);
  }, [ready, k]);
}
