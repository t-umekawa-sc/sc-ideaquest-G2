"use client";

// 業務層の共通モーダルダイアログ（デザイン標準 §モーダルダイアログ §103-107）。登録・編集フォームは原則これで開く。
// 標準構造＝.modal__panel.sectioned > .modal__header（タイトル＋⤢最大化＋×）／本文＋アクションは呼び出し側が children で渡す。
// 挙動（全入力モーダル共通）＝Esc/バックドロップ/×で閉じる・フォーカストラップ・本文先頭へ初期フォーカス・起動要素へ復帰・
// 背景スクロールロック・aria-modal/aria-labelledby・**本文スクロール**（modal__body）・**ヘッダードラッグ移動（§105）**・
// **最大化/復元（§106）**。狭幅は CSS で自動フルスクリーン＝ドラッグ/最大化は無効。portal で body 直下に描画。
// 後続（§111）＝本番形の URL 付きモーダル（Parallel/Intercept Routes・共有要素アニメ）へ載せ替え予定。
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Size = "sm" | "md" | "lg";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: Size;
  draggable?: boolean; // ヘッダーを掴んで移動（既定 on・§105「全入力モーダルで有効」）
  maximizable?: boolean; // ⤢ で最大化/復元（既定 on・§106）
  children: React.ReactNode; // 通常は <form> で body/footer を包む（下記 ModalBody/ModalFooter を使う）
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const NARROW = 640; // これ以下は自動フルスクリーン＝ドラッグ/最大化しない（shared.css と一致）

export function Modal({ open, onClose, title, size = "md", draggable = true, maximizable = true, children }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // 中央からのオフセット（ドラッグ）
  const [maximized, setMaximized] = useState(false);

  // 開くたびに中央・等倍へリセット（§105「開くたびに中央へリセット」）
  useEffect(() => {
    if (open) {
      setPos({ x: 0, y: 0 });
      setMaximized(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("modal-open");
    const panel = panelRef.current;
    // 開いたら先頭フィールドへ（本文優先・無ければパネル先頭＝× 等）
    const first =
      panel?.querySelector<HTMLElement>(`.modal__body ${FOCUSABLE.split(",").join(", .modal__body ")}`) ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) return;
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.classList.remove("modal-open");
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  // ヘッダードラッグ（§105）＝画面外に出さないよう clamp。ボタン/入力からは開始しない。
  function onHeaderPointerDown(e: React.PointerEvent) {
    if (!draggable || maximized || window.innerWidth <= NARROW) return;
    if ((e.target as HTMLElement).closest("button,input,select,textarea,a")) return;
    const panel = panelRef.current;
    if (!panel) return;
    e.preventDefault();
    const startRect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = pos.x;
    const baseY = pos.y;
    const margin = 8;

    function move(ev: PointerEvent) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // panel の left/top は startRect + (現デルタ) で移動する。viewport 内に clamp。
      const rawDx = ev.clientX - startX;
      const rawDy = ev.clientY - startY;
      const minLeft = margin;
      const maxLeft = vw - startRect.width - margin;
      const minTop = margin;
      const maxTop = vh - startRect.height - margin;
      const clampedLeft = Math.min(Math.max(startRect.left + rawDx, minLeft), Math.max(minLeft, maxLeft));
      const clampedTop = Math.min(Math.max(startRect.top + rawDy, minTop), Math.max(minTop, maxTop));
      setPos({ x: baseX + (clampedLeft - startRect.left), y: baseY + (clampedTop - startRect.top) });
    }
    function up() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  if (!open || typeof document === "undefined") return null;

  const canDrag = draggable && !maximized;
  const panelStyle = !maximized && (pos.x !== 0 || pos.y !== 0) ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined;

  return createPortal(
    <div
      className={`modal modal--${size} show${canDrag ? " modal--draggable" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className={`modal__panel sectioned${maximized ? " is-max" : ""}`} ref={panelRef} style={panelStyle}>
        <div className="modal__header" onPointerDown={onHeaderPointerDown}>
          <h2 id={titleId}>{title}</h2>
          <span className="modal__header__tools">
            {maximizable && window.innerWidth > NARROW && (
              <button
                type="button"
                className="modal__maxbtn"
                aria-label={maximized ? "元のサイズに戻す" : "最大化"}
                aria-pressed={maximized}
                onClick={() => setMaximized((v) => !v)}
              >
                {maximized ? "⤡" : "⤢"}
              </button>
            )}
            <button type="button" className="modal__close" aria-label="閉じる" onClick={onClose}>
              ✕
            </button>
          </span>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// 本文（ここだけスクロール）とアクション行（右寄せ・下端固定）。呼び出し側は <form> で両者を包む。
export function ModalBody({ children }: { children: React.ReactNode }) {
  return <div className="modal__body">{children}</div>;
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="modal__footer">{children}</div>;
}
