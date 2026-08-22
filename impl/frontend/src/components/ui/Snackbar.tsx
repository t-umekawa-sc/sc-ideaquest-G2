"use client";

// 完了通知スナックバー（デザイン標準 §14・mocks/shared.css＋shared.js の window.iqSnack を React 化）。
// SnackbarProvider を (app) レイアウトに1つ置き、useSnackbar() の show({...}) で下中央に積む。
// 業務＝意味色（success/error/info）／ゲーム＝報酬（reward/levelup＝CRTガラス＋XP/コイン/SPチップ＋きらめき）。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SnackType = "success" | "error" | "info" | "reward" | "levelup";
export type SnackReward = { k: "xp" | "coin" | "sp"; t: string };
export type SnackOptions = {
  type?: SnackType;
  title?: string;
  msg?: string;
  icon?: string;
  rewards?: SnackReward[];
  action?: { label: string; onClick?: () => void };
  duration?: number; // ms（既定＝アクション有 6000 / 無 4000）
};
type Snack = SnackOptions & { id: number };

const ICONS: Record<SnackType, string> = { success: "✅", error: "⚠️", info: "ℹ️", reward: "✨", levelup: "★" };

// 同時表示の上限（デザイン標準 §14・重なり増加時の UI）。超過は最古から退場＝FIFO。画面を埋めない。
const SNACK_MAX = 3;

const SnackbarContext = createContext<(o: SnackOptions) => void>(() => {});
export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Snack[]>([]);
  const [mounted, setMounted] = useState(false); // ポータルはマウント後のみ描画＝SSR/初回描画は null で一致（hydration mismatch 回避）
  const idRef = useRef(0);
  // 新規を末尾（最新＝最前面/下寄せ）に積み、上限 SNACK_MAX を超えたら最古（先頭）から落とす（FIFO）。
  const show = useCallback(
    (o: SnackOptions) => setItems((xs) => [...xs, { ...o, id: ++idRef.current }].slice(-SNACK_MAX)),
    [],
  );
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  useEffect(() => setMounted(true), []);
  return (
    <SnackbarContext.Provider value={show}>
      {children}
      {mounted &&
        createPortal(
          <div className="snackbar-stack" aria-live="polite" aria-atomic="false">
            {items.map((s) => (
              <SnackbarItem key={s.id} snack={s} onRemove={() => remove(s.id)} />
            ))}
          </div>,
          document.body,
        )}
    </SnackbarContext.Provider>
  );
}

function SnackbarItem({ snack, onRemove }: { snack: Snack; onRemove: () => void }) {
  const variant = snack.type === "reward" || snack.type === "levelup" ? "reward" : snack.type ?? "info";
  const dur = snack.duration ?? (snack.action ? 6000 : 4000);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setLeaving(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(onRemove, reduce ? 0 : 200);
  }, [onRemove]);

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, dur);
    return () => clearTimeout(timerRef.current);
  }, [dur, dismiss]);

  const pause = () => {
    clearTimeout(timerRef.current);
    setPaused(true);
  };
  const resume = () => {
    setPaused(false);
    timerRef.current = setTimeout(dismiss, 1500);
  };

  return (
    <div
      className={`snackbar snackbar--${variant}${leaving ? " is-leaving" : ""}`}
      role={snack.type === "error" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      <span className="snackbar__icon">{snack.icon ?? ICONS[snack.type ?? "info"]}</span>
      <div className="snackbar__body">
        {snack.title && <div className="snackbar__title">{snack.title}</div>}
        {snack.msg && <div className="snackbar__msg">{snack.msg}</div>}
        {snack.rewards && snack.rewards.length > 0 && (
          <div className="snackbar__rewards">
            {snack.rewards.map((r, i) => (
              <span key={i} className={`reward-chip ${r.k}`}>
                {r.t}
              </span>
            ))}
          </div>
        )}
      </div>
      {snack.action && (
        <button
          className="snackbar__action"
          type="button"
          onClick={() => {
            snack.action?.onClick?.();
            dismiss();
          }}
        >
          {snack.action.label}
        </button>
      )}
      <button className="snackbar__close" type="button" aria-label="閉じる" onClick={dismiss}>
        ✕
      </button>
      <span className="snackbar__timer" style={{ animationDuration: `${dur}ms`, animationPlayState: paused ? "paused" : "running" }} />
    </div>
  );
}
