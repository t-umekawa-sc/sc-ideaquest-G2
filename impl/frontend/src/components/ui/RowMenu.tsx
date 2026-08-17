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

  // 開いている行の操作セル(td.col-actions)を最前面へ（design-system.css .rowmenu-open＝z-index:1001）。
  // これをしないと、下行の sticky 操作セル（白背景）が fixed のドロップダウンを覆い、メニューが空に見える
  // （sticky セルはそれ自体がスタッキングコンテキストで、後続行が前面に来るため）。shared.js 相当。
  useEffect(() => {
    const td = triggerRef.current?.closest("td.col-actions") as HTMLElement | null;
    if (!td) return;
    td.classList.toggle("rowmenu-open", open);
    return () => td.classList.remove("rowmenu-open");
  }, [open]);

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

  // 開く前に座標を確定してから開く（先に pos を計算 → setOpen）。これをしないと最初の描画が
  // pos 未確定（fixed だが top/left なし＝ボタン直下の静的位置）になり、直後に再配置してチラつく。
  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - LIST_MIN_W) });
    setOpen(true);
  }

  return (
    <div className="rowmenu">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-outline btn-sm rowmenu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggleOpen}
      >
        ⋯
      </button>
      {open && pos && (
        <ul ref={listRef} className="rowmenu__list" role="menu" style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto" }}>
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
