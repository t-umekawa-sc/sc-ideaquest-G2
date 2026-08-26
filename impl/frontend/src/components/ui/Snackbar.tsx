"use client";

// 完了通知スナックバー（デザイン標準 §14・mocks/shared.css＋shared.js の window.iqSnack を React 化）。
// SnackbarProvider を (app) レイアウトに1つ置き、useSnackbar() の show({...}) で下中央に積む。
// 業務＝意味色（success/error/info）／ゲーム＝報酬（reward/levelup＝CRTガラス＋XP/コイン/SPチップ＋きらめき）。
//
// 重なり増加時の UI（§14・確定 2026-08-22）＝同時表示は最新 3 件。4 件目以降は上部に「▽ その他 N件」
// （標準と同じ緑ゲージ＝折りたたみ中で最後に消える隠れ通知の残り時間）を出し、クリックで全件を縦スクロール表示。
// 折りたたみ中の隠れ通知は display:none にせずオフスクリーン退避＝カウントダウンが進み続ける（.is-collapsed-hidden）。
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
type Snack = SnackOptions & { id: number; dur: number; start: number };

const ICONS: Record<SnackType, string> = { success: "✅", error: "⚠️", info: "ℹ️", reward: "✨", levelup: "★" };

// 同時表示の上限（デザイン標準 §14・重なり増加時の UI）。超過分は「▽ その他 N件」に畳む。
const SNACK_MAX = 3;

const SnackbarContext = createContext<(o: SnackOptions) => void>(() => {});
export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Snack[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false); // ポータルはマウント後のみ描画（hydration mismatch 回避）
  const idRef = useRef(0);
  const gaugeRef = useRef<HTMLSpanElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);

  const show = useCallback((o: SnackOptions) => {
    const dur = o.duration ?? (o.action ? 6000 : 4000);
    setItems((xs) => [...xs, { ...o, id: ++idRef.current, dur, start: Date.now() }]);
  }, []);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  useEffect(() => setMounted(true), []);

  const many = items.length > SNACK_MAX;
  useEffect(() => {
    if (!many && expanded) setExpanded(false);
  }, [many, expanded]);
  // 展開時は最新（下）まで見せる。
  useEffect(() => {
    if (expanded && stackRef.current) stackRef.current.scrollTop = stackRef.current.scrollHeight;
  }, [expanded, items.length]);

  // 「その他N件」トグルの残り時間ゲージ＝折りたたみ中で「最後に消える（残り最長）」隠れ通知の残りで scaleX 減少。
  // 経過分を animation-delay に先送りして現在の残りから開始（items/expanded 変化のたびに再適用）。
  useEffect(() => {
    const g = gaugeRef.current;
    if (!g) return;
    if (!many || expanded) {
      g.style.display = "none";
      return;
    }
    const hidden = items.slice(0, items.length - SNACK_MAX);
    let best: Snack | null = null;
    for (const it of hidden) if (!best || it.start + it.dur > best.start + best.dur) best = it;
    if (!best) {
      g.style.display = "none";
      return;
    }
    const elapsed = Math.max(0, Date.now() - best.start);
    g.style.display = "";
    g.style.animation = "none";
    void g.offsetWidth; // リフロー＝アニメ再適用の下ごしらえ
    g.style.animation = "iq-snack-timer linear forwards";
    g.style.animationDuration = `${best.dur}ms`;
    g.style.animationDelay = `-${elapsed}ms`;
  }, [items, expanded, many]);

  return (
    <SnackbarContext.Provider value={show}>
      {children}
      {mounted &&
        createPortal(
          <div
            ref={stackRef}
            className={`snackbar-stack${expanded && many ? " is-expanded" : ""}`}
            aria-live="polite"
            aria-atomic="false"
          >
            {many && (
              <button type="button" className="snackbar-more" onClick={() => setExpanded((e) => !e)}>
                <span className="snackbar-more__label">{expanded ? "▲ 折りたたむ" : `▽ その他 ${items.length - SNACK_MAX} 件`}</span>
                <span className="snackbar-more__timer" ref={gaugeRef} style={{ display: "none" }} />
              </button>
            )}
            {items.map((s, i) => (
              <SnackbarItem
                key={s.id}
                snack={s}
                hidden={!expanded && many && i < items.length - SNACK_MAX}
                remove={remove}
              />
            ))}
          </div>,
          document.body,
        )}
    </SnackbarContext.Provider>
  );
}

function SnackbarItem({ snack, hidden, remove }: { snack: Snack; hidden: boolean; remove: (id: number) => void }) {
  const variant = snack.type === "reward" || snack.type === "levelup" ? "reward" : snack.type ?? "info";
  const dur = snack.dur;
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // remove は安定参照・snack.id は不変＝dismiss も安定＝新着追加の再レンダでタイマーがリセットされない。
  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setLeaving(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => remove(snack.id), reduce ? 0 : 200);
  }, [remove, snack.id]);

  // 折りたたみ中（hidden＝オフスクリーン）でもタイマーは進む＝カウントダウンが止まらない。
  // dur<=0 は自動消滅しない（sticky・§4.7 検証エラー等）＝✕クローズのみ。
  useEffect(() => {
    if (dur <= 0) return;
    timerRef.current = setTimeout(dismiss, dur);
    return () => clearTimeout(timerRef.current);
  }, [dur, dismiss]);

  const pause = () => {
    clearTimeout(timerRef.current);
    setPaused(true);
  };
  const resume = () => {
    setPaused(false);
    if (dur > 0) timerRef.current = setTimeout(dismiss, 1500);
  };

  return (
    <div
      className={`snackbar snackbar--${variant}${leaving ? " is-leaving" : ""}${hidden ? " is-collapsed-hidden" : ""}`}
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
      {dur > 0 && (
        <span className="snackbar__timer" style={{ animationDuration: `${dur}ms`, animationPlayState: paused ? "paused" : "running" }} />
      )}
    </div>
  );
}
