"use client";

// 行アクション ⋯（ケバブ）メニュー（デザイン標準 §4・shared.css .rowmenu）。sticky 操作列に置く。
// ドロップダウンは table-wrap の overflow に隠れないよう position:fixed で配置（shared.js 相当）。
// リストは **document.body へ portal**＝カード/行のスタッキング文脈やトランスフォームに閉じ込められず常に最前面。
// これによりカード形式でメニューが背後カードに覆われ、クリックが背後カードに当たって誤遷移する不具合を防ぐ。
// portal でも React ツリー上は本コンポーネントの子＝イベントは `.rowmenu` を通り stopPropagation が効く。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean };

const LIST_MIN_W = 176;
const VP_MARGIN = 8; // ビューポート端との最小余白
const EST_ITEM_H = 40; // 高さ未測定時（初回・チラつき防止）の1項目あたり概算

// 同一 DataTable（[data-dt-root]）内で「下方向の配置境界」を返す＝**最終データ行の上端**と footer 上端の
// 小さい方。ここを超えて下に開くと、下開きメニューが**最終行や footer（件数/ページャ/表示件数）を覆う**
// （solid 白・z-1000 で透けはしないが、隣の行/⋯ と視覚的に衝突して見える）。境界を超えるなら上フリップする。
// - 最終行上端＝末尾の td.col-actions が属する行の上端（＝これ以下にメニューを侵入させない＝最終行を覆わない）。
//   末尾行やその直前の行から下に開くと最終行に重なるため、その場合は上へ開く。
// - DataTable 外で使う RowMenu（例＝クエスト詳細の操作メニュー）は境界なし＝従来どおりビューポート下端のみ。
function downBoundary(trigger: HTMLElement): number | null {
  const root = trigger.closest("[data-dt-root]");
  if (!root) return null;
  let limit = Number.POSITIVE_INFINITY;
  const cells = root.querySelectorAll<HTMLElement>("td.col-actions");
  const lastRow = cells[cells.length - 1]?.closest("tr");
  if (lastRow) limit = Math.min(limit, lastRow.getBoundingClientRect().top);
  const footer = root.querySelector<HTMLElement>(".dt-footer");
  if (footer) limit = Math.min(limit, footer.getBoundingClientRect().top - 4);
  return Number.isFinite(limit) ? limit : null;
}

// トリガー矩形とメニュー実高さから fixed 配置座標を求める。トリガー直下(右寄せ)を基本に、
// 下に収まらなければ（ビューポート下端 or DataTable footer 上端の手前）上へフリップし、
// 最後にビューポート内へクランプ（menuitem が画面外に出ない）。
function computePos(r: DOMRect, listH: number, maxBottom?: number | null): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(VP_MARGIN, r.right - LIST_MIN_W), vw - LIST_MIN_W - VP_MARGIN);
  // 下方向の許容下端＝ビューポート下端と footer 上端の小さい方（footer が無ければビューポートのみ）。
  const downLimit = Math.min(vh - VP_MARGIN, maxBottom ?? Number.POSITIVE_INFINITY);
  let top = r.bottom + 4; // トリガー直下
  if (listH > 0 && top + listH > downLimit) {
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
      setPos(computePos(trigger.getBoundingClientRect(), listH, downBoundary(trigger)));
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
    const trigger = triggerRef.current;
    const r = trigger?.getBoundingClientRect();
    if (r && trigger) setPos(computePos(r, items.length * EST_ITEM_H + 8, downBoundary(trigger)));
    setOpen(true);
  }

  return (
    // メニュー領域（トリガー＋fixed リスト＋各パディング）のクリックは一切カード/行へ伝播させない。
    // ボタン外側（li/ul のパディング）をクリックしても card の onRowClick（詳細遷移）が発火しないための門番。
    // リストは position:fixed だが React ツリー上は本 div の子＝React のイベントバブリングは本 div を通る。
    <div className="rowmenu" onClick={(e) => e.stopPropagation()}>
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
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <ul ref={listRef} className="rowmenu__list" role="menu" style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto" }} onClick={(e) => e.stopPropagation()}>
            {items.map((it, i) => (
              <li role="none" key={i}>
                <button
                  role="menuitem"
                  type="button"
                  className={it.danger ? "is-danger" : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  {it.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
