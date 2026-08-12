"use client";

// 行アクション ⋯（ケバブ）メニュー（デザイン標準 §4・shared.css .rowmenu）。sticky 操作列に置く。
// ドロップダウンは table-wrap の overflow に隠れないよう position:fixed で配置（shared.js 相当）。
import { useEffect, useRef, useState } from "react";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean };

const LIST_MIN_W = 176;

export function RowMenu({ items, label = "操作" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const place = () => {
      const r = trigger.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - LIST_MIN_W) }); // 右寄せ・トリガー直下
    };
    place();
    function onDown(e: MouseEvent) {
      if (listRef.current?.contains(e.target as Node) || trigger?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div className="rowmenu">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-outline btn-sm rowmenu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <ul ref={listRef} className="rowmenu__list" role="menu" style={{ position: "fixed", top: pos?.top, left: pos?.left, right: "auto" }}>
          {items.map((it, i) => (
            <li role="none" key={i}>
              <button
                role="menuitem"
                type="button"
                className={it.danger ? "is-danger" : undefined}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
