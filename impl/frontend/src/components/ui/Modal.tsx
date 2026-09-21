"use client";

// 業務層の共通モーダルダイアログ（デザイン標準 §モーダルダイアログ §103-107）。登録・編集フォームは原則これで開く。
// 標準構造＝.modal__panel.sectioned > .modal__header（タイトル＋⤢最大化＋×）／本文＋アクションは呼び出し側が children で渡す。
// 挙動（全入力モーダル共通）＝Esc/バックドロップ/×で閉じる・フォーカストラップ・本文先頭へ初期フォーカス・起動要素へ復帰・
// 背景スクロールロック・aria-modal/aria-labelledby・**本文スクロール**（modal__body）・**ヘッダードラッグ移動（§105）**・
// **最大化/復元（§106）**。portal で body 直下に描画。
// アニメは **CSS**（`.modal.show` で backdrop フェード＋パネル CRT 登場）で行う＝mock（shared.css）と同方式。
// ※ framer-motion は使わない：静止後も frameloop が毎フレーム合成を触り、半透明バックドロップが Chromium で
//   チカつく回帰（DFT-E-012）を招いたため。CSS アニメは再生後に停止し、この問題を起こさない。
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { reduceMotion } from "@/lib/motion";

type Size = "sm" | "md" | "lg" | "xl";

type Props = {
  open: boolean;
  onClose: () => void; // 閉じる要求（Esc/バックドロップ/×）。呼び出し側が open を false にする。
  onClosed?: () => void; // 閉じアニメ完了後。URL モーダルの router.back 用。
  title: string;
  size?: Size;
  draggable?: boolean; // ヘッダーを掴んで移動（既定 on・§105「全入力モーダルで有効」）
  maximizable?: boolean; // ⤢ で最大化/復元（既定 on・§106）
  children: React.ReactNode; // 通常は <form> で body/footer を包む（下記 ModalBody/ModalFooter を使う）
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const NARROW = 640; // これ以下は自動フルスクリーン＝ドラッグ/最大化しない（shared.css と一致）
const ANIM_MS = 340; // enter/exit の最大尺（CSS と一致）。閉じ＝CRT 電源OFF(.34s) 後に unmount＋onClosed する。

export function Modal({ open, onClose, onClosed, title, size = "md", draggable = true, maximizable = true, children }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // 中央からのオフセット（ドラッグ）
  const [maximized, setMaximized] = useState(false);

  // 表示状態機械（framer/AnimatePresence の置換）＝mounted で DOM 有無・visible(.show) で CSS 発火・closing(.is-closing) で閉じアニメ。
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setMounted(true);
      setClosing(false);   // 開く前フレームに is-closing を残さない（閉じアニメの誤発火防止）
      setPos({ x: 0, y: 0 });
      setMaximized(false);
      // mount 直後に .show を付けると transition が発火しない＝二重 rAF で次フレームに付ける。
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => setVisible(true));
      });
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }
    // 閉じる＝.show を外し .is-closing を付けて CRT 電源OFF→尺後に unmount＋onClosed。reduce では尺ゼロ（即時）。
    setVisible(false);
    if (mounted) {
      setClosing(true);
      const exitMs = reduceMotion() ? 0 : ANIM_MS;
      closeTimer.current = window.setTimeout(() => {
        setMounted(false);
        setClosing(false);
        closeTimer.current = null;
        onClosed?.();
      }, exitMs);
    }
    return () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
    // onClosed/mounted は依存に入れない（open の遷移でのみ動かす＝入力毎の再実行を避ける）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 初期フォーカス／スクロールロック／復帰は **mounted の遷移時のみ**。
  useEffect(() => {
    if (!mounted) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("modal-open");
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>(`.modal__body ${FOCUSABLE.split(",").join(", .modal__body ")}`) ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      document.body.classList.remove("modal-open");
      restoreRef.current?.focus?.();
    };
  }, [mounted]);

  // Esc/フォーカストラップの keydown。onClose は ref 経由で最新を参照＝依存に入れず再購読しない。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('[role="combobox"][aria-expanded="true"]')) return;
        e.stopPropagation();
        onCloseRef.current();
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
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [mounted]);

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

  if (typeof document === "undefined" || !mounted) return null;

  const canDrag = draggable && !maximized;
  const reduce = reduceMotion();
  const dragged = !maximized && (pos.x !== 0 || pos.y !== 0);

  return createPortal(
    <div
      className={`modal modal--${size}${visible ? " show" : ""}${closing ? " is-closing" : ""}${canDrag ? " modal--draggable" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        // CRT 電源ON＝細い横線が一瞬光って（`::after` フラッシュ）縦に開く（`modal-crt-open`）。CSS で再生し
        // 尺後に停止する＝framer のような常時フレームループを起こさない（DFT-E-012 の回帰対策）。
        className={`modal__panel sectioned${maximized ? " is-max" : ""}${reduce ? "" : " modal__panel--crt-in"}`}
        ref={panelRef}
        style={dragged ? { transform: `translate(${pos.x}px, ${pos.y}px)`, transformOrigin: "center center" } : undefined}
      >
        <div className="modal__header" onPointerDown={onHeaderPointerDown}>
          <h2 id={titleId}>{title}</h2>
          <span className="modal__header__tools">
            {maximizable && window.innerWidth > NARROW && (
              <button
                type="button"
                className="modal__maxbtn"
                aria-label={maximized ? "元のサイズに戻す" : "最大化"}
                title={maximized ? "元のサイズに戻す" : "最大化"}
                aria-pressed={maximized}
                onClick={() => setMaximized((v) => !v)}
              >
                {maximized ? "❐" : "⤢"}
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
