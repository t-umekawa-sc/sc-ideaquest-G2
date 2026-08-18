"use client";

// 確認ダイアログ（window.confirm の置き換え・デザイン標準・mocks/shared.js の window.iqConfirm を React 化）。
// ConfirmProvider を (app) レイアウトに1つ置き、useConfirm() の confirm({...}):Promise<boolean> で使う。
// variant='danger'（赤の確定）/'game'（ピクセル見出し＋コスト/残高プレビュー＋やめる/確定とも .btn-pixel）/既定。
// Enter=確定 / Esc・バックドロップ・✕=キャンセル / Tab フォーカストラップ。prefers-reduced-motion で動きを抑制。
// 注意（デザイン標準 §14）: 呼び出し側は「実行された処理の結果」だけを snackbar で通知する（キャンセルでは出さない）。
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ConfirmVariant = "danger" | "game";
export type ConfirmCost = { icon?: string; name: string; price: number; balance: number };
export type ConfirmOptions = {
  title?: string;
  msg?: React.ReactNode;
  icon?: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  cost?: ConfirmCost;
};

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));
export function useConfirm() {
  return useContext(ConfirmContext);
}

type Pending = { opts: ConfirmOptions; resolve: (v: boolean) => void };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ opts: o, resolve })),
    [],
  );
  const handle = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog opts={pending.opts} onResolve={handle} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ opts, onResolve }: { opts: ConfirmOptions; onResolve: (v: boolean) => void }) {
  const { variant, cost } = opts;
  const icon = opts.icon ?? (variant === "danger" ? "⚠️" : variant === "game" ? "✨" : "❓");
  const confirmLabel = opts.confirmLabel ?? (variant === "danger" ? "削除する" : variant === "game" ? "購入する" : "OK");
  const cancelLabel = opts.cancelLabel ?? (variant === "game" ? "やめる" : "キャンセル");
  const confirmCls = variant === "danger" ? "btn btn-danger" : variant === "game" ? "btn-pixel" : "btn btn-primary";
  const cancelCls = variant === "game" ? "btn-pixel btn-pixel--muted" : "btn btn-outline";

  const [show, setShow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(
    (v: boolean) => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setShow(false);
      setTimeout(() => onResolve(v), reduce ? 0 : 180);
    },
    [onResolve],
  );

  useEffect(() => {
    document.body.classList.add("modal-open");
    const prev = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => setShow(true));
    const ft = setTimeout(() => (variant === "danger" ? cancelRef : okRef).current?.focus(), 30);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === "Tab") {
        const root = rootRef.current;
        if (!root) return;
        const f = Array.from(root.querySelectorAll<HTMLElement>("button")).filter((b) => b.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(ft);
      document.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("modal-open");
      prev?.focus?.();
    };
  }, [variant, close]);

  const after = cost ? cost.balance - cost.price : 0;

  return createPortal(
    <div
      ref={rootRef}
      className={`iq-confirm${variant ? ` iq-confirm--${variant}` : ""}${show ? " show" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal__backdrop" onClick={() => close(false)} />
      <div className="modal__panel sectioned" role="document">
        <div className="modal__header">
          <h2>{opts.title ?? "確認"}</h2>
          <button className="modal__close" type="button" aria-label="閉じる" onClick={() => close(false)}>
            ✕
          </button>
        </div>
        <div className="modal__body">
          <div className="iq-confirm__body">
            <span className="iq-confirm__icon">{icon}</span>
            <div>
              {opts.msg && <p className="iq-confirm__msg">{opts.msg}</p>}
              {cost && (
                <div className="iq-confirm__cost">
                  <span className="iq-confirm__thumb">{cost.icon ?? "🎁"}</span>
                  <div className="iq-confirm__costbody">
                    <div className="iq-confirm__costname">{cost.name}</div>
                    <div className="iq-confirm__bal">
                      <span className="from">◆ {cost.balance}</span>
                      <span className="arrow">→</span>
                      <span className="to">◆ {after}</span>
                    </div>
                  </div>
                  <span className="iq-confirm__pricechip">◆ -{cost.price}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal__footer">
          <button ref={cancelRef} className={cancelCls} type="button" onClick={() => close(false)}>
            {cancelLabel}
          </button>
          <button ref={okRef} className={confirmCls} type="button" onClick={() => close(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
