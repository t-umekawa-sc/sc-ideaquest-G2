"use client";
// 一覧の操作標準（DataTable）＝業務層の一覧に「検索・ソート（単一列/複数キー）・絞り込み・
// 番号ページャ・列の表示/並べ替え/幅・CSV・表示密度・行固定（ピン）・カード/リスト切替」を
// まとめて付与する共通部品。正＝doc/画面設計/デザイン標準.md「一覧の操作標準」＋
// doc/画面設計/mocks/shared.js の window.DataTable（挙動の正）。CSS＝design-system.css §9y。
//
// モック（vanilla）との差分（意図的な React 化）:
//  ・列/カードの render は HTML 文字列ではなく ReactNode を返す（innerHTML を使わない＝XSS 安全）。
//  ・状態はイベント委譲＋再描画ではなく React state で保持。パイプライン（検索→絞込→ソート→
//    ピン分離→ページ）は純関数 compute() に分離＝将来 backend 委譲へ差し替え可能にする。
//
// 実装段階（本コミット＝②a 中核）: 型定義・compute()・テーブル描画・見出しクリック単一ソート・
// 番号ページャ・表示件数・空表示・表示密度・検索。以降のコミットで 適用中チップ/絞込・複数キー
// 並び替え（②b）・列設定/リサイズ/CSV/localStorage 永続（②c）・ピン/カード切替/クリック標準（②d）。
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export type SortDir = "asc" | "desc";
export type SortKey = { key: string; dir: SortDir };

// 絞り込み条件（項目別）。列定義の filter.type と対応。
export type FilterCond =
  | { type: "text"; key: string; q: string }
  | { type: "enum"; key: string; values: string[] }
  | { type: "number"; key: string; min: number | null; max: number | null }
  | { type: "date"; key: string; from: string; to: string };

// 列に絞り込みUIを付ける宣言。enum は選択肢 [value, label] を持つ。
export type ColumnFilter =
  | { type: "text" }
  | { type: "enum"; options: [string, string][] }
  | { type: "number" }
  | { type: "date" };

// カード表示（cardLayout）の標準構造ヘルパ。
export type CardLayout = {
  title?: ReactNode;
  badges?: ({ label: string; cls?: string } | null | false)[];
  meta?: (ReactNode | null | false)[];
  stats?: (ReactNode | null | false)[];
};

export type DataTableColumn<T> = {
  key: string;
  label: string;
  locked?: boolean; // 列設定で非表示・並べ替え不可（必須列）
  width?: number; // 宣言幅（比率の元。px ではなく相対）
  sortable?: boolean;
  align?: "num"; // 数値列＝右寄せ
  hiddenDefault?: boolean; // 既定は非表示（列設定で表示可。例＝「新着順」用の投稿日列）
  actions?: boolean; // 操作列（sticky・ソート/リサイズ対象外）
  cellClass?: string;
  filter?: ColumnFilter;
  render?: (r: T) => ReactNode; // セル内容（未指定＝sortVal を文字列表示）
  sortVal?: (r: T) => string | number; // ソート/既定表示/検索フォールバックに使う値
  searchVal?: (r: T) => string; // 横断検索の対象文字列（未指定＝sortVal）
  filterVal?: (r: T) => string | number; // 絞り込みの評価値（未指定＝sortVal）
  csvVal?: (r: T) => string; // CSV セル（未指定＝sortVal / render のテキスト）
};

export type DataTableProps<T> = {
  storageKey: string; // localStorage 永続キー（②c）。プレフィックス ideaquest_dt_ を付与。
  data: T[];
  columns: DataTableColumn<T>[];
  rowId?: (r: T) => string | number;
  unit?: string; // 件数の単位（既定「件」）
  perPage?: number;
  perPageOptions?: number[];
  maxPins?: number;
  searchFields?: string; // 検索プレースホルダ用（「◯◯・◯◯ を検索…」）
  searchPlaceholder?: string;
  exportName?: string;
  onRowClick?: (r: T) => void; // 行/カードのクリック標準（§4.5⑪）
  emptyText?: ReactNode;
  rowClass?: (r: T) => string | undefined;
  pins?: boolean; // false で行固定（ピン）を無効化
  defaultView?: "list" | "card";
  card?: (r: T) => ReactNode; // カード本文（自由）
  cardLayout?: (r: T) => CardLayout; // カード本文（標準構造）
  cardRaw?: (r: T) => ReactNode; // カード外側まで含む完全制御
};

// ---- パイプライン（純関数） ------------------------------------------------
// 検索→絞込→ソート→ピン分離。ページ分割は呼び出し側で行う（ピン件数に依存するため）。
type ComputeState<T> = {
  search: string;
  simpleSort: SortKey | null;
  advSort: SortKey[];
  filters: Record<string, FilterCond>;
  pins: string[];
  pinsEnabled: boolean;
};

export function activeSort(s: Pick<ComputeState<unknown>, "simpleSort" | "advSort">): SortKey[] {
  return s.advSort.length ? s.advSort : s.simpleSort ? [s.simpleSort] : [];
}

function searchText<T>(r: T, dataCols: DataTableColumn<T>[]): string {
  const sc = dataCols.filter((c) => c.searchVal);
  const src = sc.length
    ? sc.map((c) => c.searchVal!(r))
    : dataCols.map((c) => (c.sortVal ? String(c.sortVal(r)) : ""));
  return src.join(" ").toLowerCase();
}

function matchFilters<T>(r: T, filters: Record<string, FilterCond>, colByKey: Record<string, DataTableColumn<T>>): boolean {
  return Object.keys(filters).every((key) => {
    const col = colByKey[key];
    if (!col) return true;
    const cond = filters[key];
    const raw = col.filterVal ? col.filterVal(r) : col.sortVal ? col.sortVal(r) : "";
    if (cond.type === "text") return String(raw).toLowerCase().includes(cond.q.toLowerCase());
    if (cond.type === "enum") return cond.values.includes(String(raw));
    if (cond.type === "number") {
      const n = Number(raw);
      return (cond.min == null || n >= cond.min) && (cond.max == null || n <= cond.max);
    }
    // date
    const v = String(raw);
    return (!cond.from || v >= cond.from) && (!cond.to || v <= cond.to);
  });
}

function makeComparator<T>(sort: SortKey[], colByKey: Record<string, DataTableColumn<T>>) {
  return (a: T, b: T): number => {
    for (const s of sort) {
      const col = colByKey[s.key];
      if (!col?.sortVal) continue;
      const va = col.sortVal(a);
      const vb = col.sortVal(b);
      const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "ja");
      if (d) return s.dir === "desc" ? -d : d;
    }
    return 0;
  };
}

export function computeRows<T>(
  data: T[],
  dataCols: DataTableColumn<T>[],
  colByKey: Record<string, DataTableColumn<T>>,
  rowId: (r: T) => string | number,
  st: ComputeState<T>,
): { pinned: T[]; filtered: T[] } {
  const sort = activeSort(st);
  const sorted = sort.length ? [...data].sort(makeComparator(sort, colByKey)) : [...data];
  const pinnedIds = st.pinsEnabled ? st.pins : [];
  const pinned = sorted.filter((r) => pinnedIds.includes(String(rowId(r))));
  const search = st.search.toLowerCase();
  const filtered = sorted.filter((r) => {
    if (pinnedIds.includes(String(rowId(r)))) return false;
    if (search && !searchText(r, dataCols).includes(search)) return false;
    return matchFilters(r, st.filters, colByKey);
  });
  return { pinned, filtered };
}

// 番号ページャの表示ページ列（…省略込み）。mock renderPager と同じアルゴリズム。
function pageWindow(cur: number, pages: number): (number | "…")[] {
  const win = 2;
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || (p >= cur - win && p <= cur + win)) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return nums;
}

// ---- コンポーネント --------------------------------------------------------
export function DataTable<T>(props: DataTableProps<T>) {
  const { data, unit = "件", pins: pinsProp } = props;
  const rowId = props.rowId ?? ((r: T) => (r as { id: string | number }).id);
  const pinsEnabled = pinsProp !== false;
  const perPageOptionsBase = props.perPageOptions ?? [10, 20, 50, 100];

  // 列の正規化（resizable/sortable の既定）。
  const cols = useMemo(
    () => props.columns.map((c) => ({ resizable: !c.actions, sortable: false, ...c })),
    [props.columns],
  );
  const dataCols = useMemo(() => cols.filter((c) => !c.actions), [cols]);
  const colByKey = useMemo(() => Object.fromEntries(cols.map((c) => [c.key, c])) as Record<string, DataTableColumn<T>>, [cols]);
  const defaultOrder = useMemo(() => dataCols.map((c) => c.key), [dataCols]);

  // ---- 状態（②a は in-memory。localStorage 永続は ②c で追加） ----
  const [search, setSearch] = useState("");
  const [simpleSort, setSimpleSort] = useState<SortKey | null>(null);
  const [advSort] = useState<SortKey[]>([]); // 複数キー並び替えは ②b
  const [filters] = useState<Record<string, FilterCond>>({}); // 絞り込みは ②b
  const [pins] = useState<string[]>([]); // ピンは ②d
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(props.perPage ?? 20);
  const [density, setDensity] = useState<"normal" | "compact">("normal");
  const [order] = useState<string[]>(defaultOrder); // 列並べ替えは ②c
  const [hidden] = useState<string[]>(dataCols.filter((c) => c.hiddenDefault).map((c) => c.key)); // 列表示切替は ②c

  const perPageOptions = useMemo(() => {
    const opts = [...perPageOptionsBase];
    if (!opts.includes(perPage)) {
      opts.push(perPage);
      opts.sort((a, b) => a - b);
    }
    return opts;
  }, [perPageOptionsBase, perPage]);

  const visibleDataCols = useMemo(
    () => order.map((k) => colByKey[k]).filter((c): c is DataTableColumn<T> => Boolean(c) && !hidden.includes(c.key)),
    [order, colByKey, hidden],
  );
  const actionsCol = useMemo(() => cols.find((c) => c.actions) ?? null, [cols]);
  const visibleCols = useMemo(
    () => (actionsCol ? [...visibleDataCols, actionsCol] : visibleDataCols),
    [visibleDataCols, actionsCol],
  );

  const { pinned, filtered } = useMemo(
    () => computeRows(data, dataCols, colByKey, rowId, { search, simpleSort, advSort, filters, pins, pinsEnabled }),
    [data, dataCols, colByKey, rowId, search, simpleSort, advSort, filters, pins, pinsEnabled],
  );

  const totalNonPin = filtered.length;
  const pages = Math.max(1, Math.ceil(totalNonPin / perPage));
  const curPage = Math.min(Math.max(1, page), pages);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);
  const isEmpty = totalNonPin + pinned.length === 0;

  const sort = activeSort({ simpleSort, advSort });
  const advOn = advSort.length > 0;

  // 列幅（宣言幅の比率を % で。テーブルには min-width=合計*0.8 を課す）。
  const widths = visibleCols.map((c) => c.width ?? 0);
  const sumW = widths.reduce((a, b) => a + b, 0) || 1;
  const minWidthPx = Math.round(sumW * 0.8);

  function onHeaderClick(col: DataTableColumn<T>) {
    if (!col.sortable || advOn) return;
    const cur = simpleSort && simpleSort.key === col.key ? simpleSort.dir : null;
    setSimpleSort(cur === "asc" ? { key: col.key, dir: "desc" } : cur === "desc" ? null : { key: col.key, dir: "asc" });
    setPage(1);
  }

  const searchPlaceholder =
    props.searchPlaceholder ?? (props.searchFields ? `${props.searchFields} を検索…` : "検索…");

  return (
    <div>
      <div className="list-toolbar" data-dt-toolbar>
        <div className="filters">
          <div className="dt-search">
            <span className="dt-search__ic" aria-hidden="true">
              🔍
            </span>
            <input
              className="input"
              type="search"
              value={search}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="tools">
          <span className="seg seg-density" role="group" aria-label="表示密度">
            <button
              className="seg__btn"
              type="button"
              aria-pressed={density === "normal"}
              onClick={() => setDensity("normal")}
            >
              標準
            </button>
            <button
              className="seg__btn"
              type="button"
              aria-pressed={density === "compact"}
              onClick={() => setDensity("compact")}
            >
              コンパクト
            </button>
          </span>
        </div>
      </div>

      <div className="table-wrap dt-scroll">
        <table
          className={`table dt-fixed${density === "compact" ? " table--compact" : ""}`}
          style={{ minWidth: `${minWidthPx}px` }}
        >
          <thead>
            <tr>
              {visibleCols.map((c, idx) => {
                const pct = widths[idx] ? (widths[idx] / sumW) * 100 : 0;
                let ariaSort: "ascending" | "descending" | "none" | undefined;
                if (!c.sortable) ariaSort = undefined;
                else if (!advOn && simpleSort && simpleSort.key === c.key)
                  ariaSort = simpleSort.dir === "asc" ? "ascending" : "descending";
                else ariaSort = "none";
                const cls = [
                  c.align === "num" ? "num" : "",
                  c.actions ? "col-actions" : "",
                  c.sortable ? "dt-sortable" : "",
                  c.sortable && advOn ? "is-locked-sort" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={cls || undefined}
                    aria-sort={ariaSort}
                    data-key={c.key}
                    style={pct ? { width: `${pct.toFixed(4)}%` } : undefined}
                    onClick={() => onHeaderClick(c)}
                  >
                    <div className="dt-th">
                      <span className="dt-th__label">{c.label}</span>
                      {c.sortable ? <span className="dt-sort-ind" /> : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const id = String(rowId(r));
              const trCls = [props.onRowClick ? "dt-row--link" : "", props.rowClass?.(r) ?? ""].filter(Boolean).join(" ");
              return (
                <tr
                  key={id}
                  data-dt-row={id}
                  className={trCls || undefined}
                  onClick={props.onRowClick ? () => props.onRowClick!(r) : undefined}
                >
                  {visibleCols.map((c) => {
                    const cellCls = [c.align === "num" ? "num" : "", c.actions ? "col-actions" : "", c.cellClass ?? ""]
                      .filter(Boolean)
                      .join(" ");
                    const inner = c.render ? c.render(r) : c.sortVal ? String(c.sortVal(r)) : "";
                    return (
                      <td key={c.key} className={cellCls || undefined}>
                        {inner}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isEmpty ? <div className="list-empty">{props.emptyText ?? "該当するデータがありません。"}</div> : null}

      <div className="dt-footer">
        <span className="list-count">
          {totalNonPin} {unit}
          {pinned.length ? `（＋固定 ${pinned.length}）` : ""}
        </span>
        {pages > 1 ? (
          <nav className="pagination" aria-label="ページ送り">
            <button
              className="btn btn-outline btn-sm"
              type="button"
              disabled={curPage <= 1}
              aria-label="前のページ"
              onClick={() => setPage(curPage - 1)}
            >
              ‹
            </button>
            {pageWindow(curPage, pages).map((n, i) =>
              n === "…" ? (
                <span key={`e${i}`} className="pagination__ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  className={`btn btn-outline btn-sm pagination__page${n === curPage ? " is-current" : ""}`}
                  type="button"
                  aria-label={`${n}ページ目`}
                  aria-current={n === curPage ? "page" : undefined}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              ),
            )}
            <button
              className="btn btn-outline btn-sm"
              type="button"
              disabled={curPage >= pages}
              aria-label="次のページ"
              onClick={() => setPage(curPage + 1)}
            >
              ›
            </button>
          </nav>
        ) : null}
        <label className="dt-perpage">
          表示
          <select
            className="select"
            value={perPage}
            aria-label="1ページの表示件数"
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
          >
            {perPageOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          件
        </label>
      </div>
    </div>
  );
}
