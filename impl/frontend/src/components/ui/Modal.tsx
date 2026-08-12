"use client";

// 業務層の共通モーダルダイアログ（デザイン標準 §モーダルダイアログ）。登録・編集フォームは原則これで開く。
// 標準構造＝.modal__panel.sectioned > .modal__header（タイトル＋×）／本文＋アクションは呼び出し側が children で渡す
// （フォーム送信の都合上、body/footer を <form> で包む構成にできるよう children 委譲）。
// 挙動＝Esc/バックドロップ/×で閉じる・フォーカストラップ・開いたら先頭へ初期フォーカス・閉じたら起動要素へ復帰・
// 背景スクロールロック・aria-modal/aria-labelledby。狭幅は CSS で自動フルスクリーン。portal で body 直下に描画。
// 本番形（URL 付きモーダル＝Parallel/Intercept Routes）は将来スライスで載せ替える（本部品は client ダイアログ）。
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

type Size = "sm" | "md" | "lg";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: Size;
  children: React.ReactNode; // 通常は <form> で body/footer を包む（下記 ModalBody/ModalFooter を使う）
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, size = "md", children }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("modal-open");
    // 開いたら先頭フィールドへ（本文優先・無ければパネル先頭＝× ボタン等）
    const panel = panelRef.current;
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
      // フォーカストラップ
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
      restoreRef.current?.focus?.(); // 起動要素へフォーカス復帰
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={`modal modal--${size} show`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__panel sectioned" ref={panelRef}>
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal__close" aria-label="閉じる" onClick={onClose}>
            ✕
          </button>
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
