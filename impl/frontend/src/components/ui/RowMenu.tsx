"use client";

// 行アクション ⋯（ケバブ）メニュー（デザイン標準 §4・shared.css .rowmenu）。sticky 操作列に置く。
// ドロップダウンは table-wrap の overflow に隠れないよう position:fixed で配置（shared.js 相当）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean };

const LIST_MIN_W = 176;
const VP_MARGIN = 8; // ビューポート端との最小余白
const EST_ITEM_H = 40; // 高さ未測定時（初回・チラつき防止）の1項目あたり概算

// トリガー矩形とメニュー実高さから fixed 配置座標を求める。トリガー直下(右寄せ)を基本に、
// 下に収まらなければ上へフリップし、最後にビューポート内へクランプ（menuitem が画面外に出ない）。
function computePos(r: DOMRect, listH: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(VP_MARGIN, r.right - LIST_MIN_W), vw - LIST_MIN_W - VP_MARGIN);
  let top = r.bottom + 4; // トリガー直下
  if (listH > 0 && top + listH > vh - VP_MARGIN) {
    const above = r.top - 4 - listH; // 下に収まらない → 上へフリップ
    top = above >= VP_MARGIN ? above : Math.max(VP_MARGIN, vh - VP_MARGIN - listH);
  }
  return { top, left };
}

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

  // 配置は useLayoutEffect（描画前確定）＝メニュー実高さを測って上フリップ/クランプを適用し、
  // ペイント前に最終座標へ。これによりスクロール追従以外での再配置ジッタが出ない（stability 揺れ解消）。
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const place = () => {
      const listH = listRef.current?.offsetHeight ?? 0;
      setPos(computePos(trigger.getBoundingClientRect(), listH));
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
  // 高さ未測定なので項目数から概算し、上フリップ判定を初回描画から効かせる（実測は useLayoutEffect で補正）。
  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos(computePos(r, items.length * EST_ITEM_H + 8));
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
        onClick={(e) => {
          e.stopPropagation(); // カード/行の onRowClick（主アクション）へ伝播させない（§4.5⑪・カード形式で誤遷移防止）
          toggleOpen();
        }}
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
                onClick={(e) => {
                  e.stopPropagation(); // カード/行の onRowClick へ伝播させない（fixed リストでもカードの子孫のため）
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
