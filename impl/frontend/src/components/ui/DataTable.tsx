"use client";
// 一覧の操作標準（DataTable）＝業務層の一覧に「検索・ソート（単一列/複数キー）・絞り込み・
// 番号ページャ・列の表示/並べ替え/幅・CSV・表示密度・行固定（ピン）・カード/リスト切替」を
// まとめて付与する共通部品。正＝doc/画面設計/デザイン標準.md「一覧の操作標準」＋
// doc/画面設計/mocks/shared.js の window.DataTable（挙動の正）。CSS＝design-system.css §9y。
//
// モック（vanilla）との差分（意図的な React 化）:
//  ・列/カードの render は HTML 文字列ではなく ReactNode を返す（innerHTML を使わない＝XSS 安全）。
//    → 操作列（actions）は消費側が render で <RowMenu> 等を渡す（DataTable は RowMenu に非依存）。
//  ・状態はイベント委譲＋再描画ではなく React state。パイプライン（検索→絞込→ソート→ピン分離→
//    ページ）は純関数 computeRows() に分離＝将来 backend 委譲へ差し替え可能。
//  ・CSV セルは render(ReactNode) から文字を抜けないため csvVal / sortVal を用いる（render のみの
//    列は csvVal を渡す。未指定なら空セル）。
//
// 永続（localStorage・キー接頭辞 ideaquest_dt_）＝列順/非表示/幅/密度/ピン/表示件数/ビュー。
// 検索/ソート/絞込/ページはセッション（非永続）。SSR ハイドレーション不整合を避けるため、
// 初期描画は既定値→マウント後に localStorage から復元（ready フラグで復元前の上書き保存を抑止）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal, ModalBody, ModalFooter } from "./Modal";

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

// ---- サーバー駆動モード（§1.8.1 DataTable クエリ契約の委譲境界） --------------
// server プロップがあるとき、DataTable は computeRows()／ローカルページングをバイパスし、
// query(state) が返す {rows,total,pinned} をそのまま描画する（並び/絞込/件数/ページ/ピンは
// サーバーが確定）。state→クエリ文字列の変換は呼び出し側（feature の api）が担う＝DataTable は
// ドメイン非依存を保つ（コーディング規約 §4.1）。正＝doc/API設計/README.md §1.8.1。
export type QueryState = {
  search: string; // トリム済み横断検索（→ ?q=）
  sort: SortKey[]; // 複数ソート（左優先・desc は - 前置）
  filters: Record<string, FilterCond>; // 項目別フィルタ（列 key ごと）
  page: number;
  perPage: number;
  pinIds: string[]; // 固定行 ID（localStorage 由来・ページ跨ぎ解決用）
};
export type ServerResult<T> = {
  rows: T[]; // 現ページの非固定行（サーバーが並び/絞込/ページング済み）
  total: number; // 非固定母集合の総件数（件数バッジ・ページャの元）
  pinned?: T[]; // 固定行（ページ/絞込に関係なく解決・既定 []）
};
export type DataTableServer<T> = {
  query: (state: QueryState, signal: AbortSignal) => Promise<ServerResult<T>>;
  onExport?: (state: QueryState, columns: string[]) => void; // 表示中データ列 key（表示順）
};

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
  csvVal?: (r: T) => string; // CSV セル（未指定＝sortVal）
};

export type DataTableProps<T> = {
  storageKey: string;
  data?: T[]; // client モード＝全件。server モードでは不要（省略可）。
  server?: DataTableServer<T>; // 指定時＝サーバー駆動（computeRows/ローカルページングをバイパス）。
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

const LS = "ideaquest_dt_";
type Density = "normal" | "compact";
type View = "list" | "card";
type Persisted = {
  order?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
  density?: Density;
  pins?: string[];
  perPage?: number;
  view?: View;
};

// ---- パイプライン（純関数） ------------------------------------------------
type ComputeState = {
  search: string;
  simpleSort: SortKey | null;
  advSort: SortKey[];
  filters: Record<string, FilterCond>;
  pins: string[];
  pinsEnabled: boolean;
};

export function activeSort(s: Pick<ComputeState, "simpleSort" | "advSort">): SortKey[] {
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
  st: ComputeState,
): { pinned: T[]; filtered: T[] } {
  const sort = activeSort(st);
  const sorted = sort.length ? [...data].sort(makeComparator(sort, colByKey)) : [...data];
  const pinnedIds = st.pinsEnabled ? st.pins : [];
  const pinned = sorted.filter((r) => pinnedIds.includes(String(rowId(r))));
  const search = st.search.trim().toLowerCase();
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

// 値のデバウンス（サーバーモードの横断検索用＝入力のたびに fetch しない）。
function useDebouncedValue<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---- コンポーネント --------------------------------------------------------
export function DataTable<T>(props: DataTableProps<T>) {
  const { unit = "件", pins: pinsProp, storageKey, server } = props;
  const hasServer = Boolean(server);
  const rowId = props.rowId ?? ((r: T) => (r as { id: string | number }).id);
  const pinsEnabled = pinsProp !== false;
  const maxPins = props.maxPins ?? 5;
  const perPageOptionsBase = props.perPageOptions ?? [10, 20, 50, 100];
  const hasCard = Boolean(props.card || props.cardLayout || props.cardRaw);

  // data は参照安定化（server モードでは props.data 省略＝安定した [] を返す）。
  const data = useMemo(() => props.data ?? [], [props.data]);

  // 列の既定は falsy 判定（sortable 未指定＝不可）と !c.actions（リサイズ可）で扱う。
  const cols = props.columns;
  const dataCols = useMemo(() => cols.filter((c) => !c.actions), [cols]);
  const actionsCol = useMemo(() => cols.find((c) => c.actions) ?? null, [cols]);
  const colByKey = useMemo(() => Object.fromEntries(cols.map((c) => [c.key, c])) as Record<string, DataTableColumn<T>>, [cols]);
  const defaultOrder = useMemo(() => dataCols.map((c) => c.key), [dataCols]);
  const defaultHidden = useMemo(() => dataCols.filter((c) => c.hiddenDefault).map((c) => c.key), [dataCols]);
  const sortableCols = useMemo(() => dataCols.filter((c) => c.sortable), [dataCols]);
  const filterableCols = useMemo(() => dataCols.filter((c) => c.filter), [dataCols]);

  // ---- 状態 ----
  // セッション（非永続）
  const [search, setSearch] = useState("");
  const [simpleSort, setSimpleSort] = useState<SortKey | null>(null);
  const [advSort, setAdvSort] = useState<SortKey[]>([]);
  const [filters, setFilters] = useState<Record<string, FilterCond>>({});
  const [page, setPage] = useState(1);
  // 永続
  const [perPage, setPerPage] = useState(props.perPage ?? 20);
  const [density, setDensity] = useState<Density>("normal");
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<string[]>([]);
  const [view, setView] = useState<View>(hasCard ? props.defaultView ?? "list" : "list");
  // UI
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [ready, setReady] = useState(false);

  // サーバー駆動モードの状態（server プロップ時のみ意味を持つ）。
  const [srv, setSrv] = useState<ServerResult<T> | null>(null);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvError, setSrvError] = useState(false);
  const [srvLoaded, setSrvLoaded] = useState(false); // 初回ロード完了（空表示のフラッシュ防止）
  const seqRef = useRef(0); // 最新リクエストのみ commit（stale レース回避）
  const serverRef = useRef(server); // inline server={{...}} の identity 変化で effect が暴発しないよう ref 経由で参照
  serverRef.current = server;

  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // 復元（マウント後・1回）。列/選択肢は現在の定義で検証してから適用。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS + storageKey);
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        if (Array.isArray(p.order)) {
          const valid = p.order.filter((k) => colByKey[k] && !colByKey[k].actions);
          defaultOrder.forEach((k) => { if (!valid.includes(k)) valid.push(k); });
          setOrder(valid);
        }
        if (Array.isArray(p.hidden)) setHidden(p.hidden.filter((k) => colByKey[k]));
        if (p.widths) setWidths(p.widths);
        if (p.density === "compact" || p.density === "normal") setDensity(p.density);
        if (Array.isArray(p.pins)) setPins(p.pins.map(String));
        if (typeof p.perPage === "number") setPerPage(p.perPage);
        if ((p.view === "card" || p.view === "list") && hasCard) setView(p.view);
      }
    } catch {
      /* 破損時は既定のまま */
    }
    setReady(true);
    // colByKey/defaultOrder は定義由来で安定。storageKey 変化時のみ再復元。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // 保存（復元後のみ）。
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LS + storageKey, JSON.stringify({ order, hidden, widths, density, pins, perPage, view } satisfies Persisted));
    } catch {
      /* 保存失敗は無視 */
    }
  }, [ready, storageKey, order, hidden, widths, density, pins, perPage, view]);

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
  const visibleCols = useMemo(
    () => (actionsCol ? [...visibleDataCols, actionsCol] : visibleDataCols),
    [visibleDataCols, actionsCol],
  );

  // サーバー駆動モードのクエリ状態（横断検索はデバウンス・ソート/フィルタ/ページ/ピンは即時）。
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const serverState = useMemo<QueryState>(
    () => ({
      search: debouncedSearch,
      sort: activeSort({ simpleSort, advSort }),
      filters,
      page,
      perPage,
      pinIds: pinsEnabled ? pins : [],
    }),
    [debouncedSearch, simpleSort, advSort, filters, page, perPage, pins, pinsEnabled],
  );

  // 再クエリ（server モード・localStorage 復元後）。seq+AbortController で stale レースを排除。
  useEffect(() => {
    if (!hasServer || !ready) return;
    const my = ++seqRef.current;
    const ac = new AbortController();
    setSrvLoading(true);
    setSrvError(false);
    serverRef.current!.query(serverState, ac.signal)
      .then((r) => {
        if (my !== seqRef.current) return;
        setSrv(r);
        setSrvLoaded(true);
        setSrvLoading(false);
      })
      .catch(() => {
        if (ac.signal.aborted || my !== seqRef.current) return;
        setSrvError(true);
        setSrvLoading(false);
      });
    return () => ac.abort();
  }, [hasServer, ready, serverState]);

  // client モードのパイプライン（server モードでは母集合として未使用＝空 data で軽量）。
  const clientResult = useMemo(
    () => computeRows(data, dataCols, colByKey, rowId, { search, simpleSort, advSort, filters, pins, pinsEnabled }),
    [data, dataCols, colByKey, rowId, search, simpleSort, advSort, filters, pins, pinsEnabled],
  );

  const pinned = hasServer ? srv?.pinned ?? [] : clientResult.pinned;
  const filtered = clientResult.filtered; // client モードの非固定母集合
  const totalNonPin = hasServer ? srv?.total ?? 0 : filtered.length;
  const pages = Math.max(1, Math.ceil(totalNonPin / perPage));
  const curPage = Math.min(Math.max(1, page), pages);
  const start = (curPage - 1) * perPage;
  const pageRows = hasServer ? srv?.rows ?? [] : filtered.slice(start, start + perPage);
  const useCard = hasCard && view === "card";
  const showLoading = hasServer && srvLoading && !srvLoaded; // 初回ロード中（以降は前回行を保持して再取得）
  const isEmpty = hasServer
    ? srvLoaded && !srvLoading && totalNonPin + pinned.length === 0
    : totalNonPin + pinned.length === 0;

  // ページ範囲外へ縮んだら最終ページへ寄せる（server モード・絞込で件数が減った時）。
  useEffect(() => {
    if (hasServer && page > pages) setPage(pages);
  }, [hasServer, page, pages]);

  const sort = activeSort({ simpleSort, advSort });
  const advOn = advSort.length > 0;
  const searchActive = search.trim(); // チップの表示/判定はトリム値（入力欄は生値のまま＝内部空白を打てる）

  // 列幅（宣言幅の比率を % で。テーブルには min-width=合計*0.8 を課す）。
  const colWidths = visibleCols.map((c) => widths[c.key] ?? c.width ?? 0);
  const sumW = colWidths.reduce((a, b) => a + b, 0) || 1;
  const minWidthPx = Math.round(sumW * 0.8);

  // 固定行の段積み sticky（ヘッダー配下に累積 top）。
  useLayoutEffect(() => {
    const tb = tbodyRef.current;
    if (!tb) return;
    const trs = Array.from(tb.querySelectorAll<HTMLTableRowElement>("tr.is-pinned"));
    trs.forEach((tr) => tr.classList.remove("dt-pin-sep"));
    if (!trs.length) return;
    trs[trs.length - 1].classList.add("dt-pin-sep");
    let top = theadRef.current?.offsetHeight ?? 0;
    trs.forEach((tr) => {
      tr.style.setProperty("--dt-row-top", `${top}px`);
      top += tr.offsetHeight;
    });
  }, [pageRows, pinned, density, view, order, hidden, widths]);

  // 列設定メニューの外側クリックで閉じる。
  useEffect(() => {
    if (!colMenuOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (colMenuRef.current?.contains(t) || colBtnRef.current?.contains(t)) return;
      setColMenuOpen(false);
    }
    document.addEventListener("click", onDoc, true);
    return () => document.removeEventListener("click", onDoc, true);
  }, [colMenuOpen]);

  // ---- ハンドラ ----
  function onHeaderClick(col: DataTableColumn<T>, e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".dt-resizer")) return;
    if (!col.sortable || advOn) return;
    const cur = simpleSort && simpleSort.key === col.key ? simpleSort.dir : null;
    setSimpleSort(cur === "asc" ? { key: col.key, dir: "desc" } : cur === "desc" ? null : { key: col.key, dir: "asc" });
    setPage(1);
  }

  function clearAll() {
    setSearch("");
    setSimpleSort(null);
    setAdvSort([]);
    setFilters({});
    setPage(1);
  }

  function togglePin(id: string) {
    setPins((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxPins) {
        alert(`固定できる行は最大 ${maxPins} 件です。`);
        return prev;
      }
      return [...prev, id];
    });
  }

  // 行/カードのクリック標準（インタラクティブ要素上のクリックは主アクションにしない）。
  function onRowActivate(r: T, e: React.MouseEvent | React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest("a,button,input,select,label")) return;
    props.onRowClick?.(r);
  }

  function startResize(key: string, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    if (!th) return;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    document.body.classList.add("dt-resizing");
    (e.target as HTMLElement).classList.add("dt-resizer--active");
    const move = (ev: PointerEvent) => {
      const w = Math.max(64, startW + (ev.clientX - startX));
      setWidths((prev) => ({ ...prev, [key]: Math.round(w) }));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.classList.remove("dt-resizing");
      (e.target as HTMLElement).classList.remove("dt-resizer--active");
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function moveColumn(key: string, dir: -1 | 1) {
    setOrder((prev) => {
      const i = prev.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      if (colByKey[prev[j]]?.locked || colByKey[key]?.locked) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function toggleColumn(key: string, shown: boolean) {
    setHidden((prev) => (shown ? prev.filter((k) => k !== key) : prev.includes(key) ? prev : [...prev, key]));
  }

  function openColMenu() {
    if (colMenuOpen) {
      setColMenuOpen(false);
      return;
    }
    const rect = colBtnRef.current?.getBoundingClientRect();
    if (rect) setColMenuPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)) });
    setColMenuOpen(true);
  }

  function exportCsv() {
    // server モード＝表示中データ列（表示順）を渡してサーバー生成へ委譲（同一絞込/ソートの全件）。
    if (serverRef.current?.onExport) {
      serverRef.current.onExport(serverState, visibleDataCols.map((c) => c.key));
      return;
    }
    const vc = visibleDataCols;
    const head = vc.map((c) => c.label);
    const cell = (c: DataTableColumn<T>, r: T) => (c.csvVal ? c.csvVal(r) : c.sortVal ? String(c.sortVal(r)) : "");
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [head.map(q).join(",")].concat(filtered.map((r) => vc.map((c) => q(cell(c, r))).join(",")));
    const csv = rows.join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${props.exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- 表示ヘルパ ----
  const labelOf = (k: string) => colByKey[k]?.label ?? k;
  function enumLabel(key: string, v: string) {
    const f = colByKey[key]?.filter;
    if (f?.type === "enum") return f.options.find((o) => o[0] === v)?.[1] ?? v;
    return v;
  }
  function filterSummary(c: FilterCond): string {
    if (c.type === "text") return `「${c.q}」を含む`;
    if (c.type === "enum") return c.values.map((v) => enumLabel(c.key, v)).join("・");
    if (c.type === "number") return `${c.min ?? ""}〜${c.max ?? ""}`;
    return `${c.from || ""}〜${c.to || ""}`;
  }

  const searchPlaceholder =
    props.searchPlaceholder ?? (props.searchFields ? `${props.searchFields} を検索…` : "検索…");

  // カード本文（cardLayout の標準構造）。
  function cardBody(r: T): ReactNode {
    if (props.card) return props.card(r);
    const L = props.cardLayout!(r) || {};
    const badges = (L.badges ?? []).filter(Boolean) as { label: string; cls?: string }[];
    const meta = (L.meta ?? []).filter((x) => x != null && x !== "");
    const stats = (L.stats ?? []).filter((x) => x != null && x !== "");
    return (
      <>
        {L.title != null && <div className="dt-card__title">{L.title}</div>}
        {(badges.length > 0 || meta.length > 0) && (
          <div className="dt-card__meta">
            {badges.map((b, i) => (
              <span key={`b${i}`} className={`badge ${b.cls ?? "badge-muted"}`}>
                {b.label}
              </span>
            ))}
            {meta.map((m, i) => (
              <span key={`m${i}`}>{m}</span>
            ))}
          </div>
        )}
        {stats.length > 0 && (
          <div className="dt-card__stats">
            {stats.map((s, i) => (
              <span key={`s${i}`}>{s}</span>
            ))}
          </div>
        )}
      </>
    );
  }

  function pinButton(id: string, pinnedNow: boolean, float: boolean) {
    if (!pinsEnabled) return null;
    return (
      <button
        className={`dt-pin-toggle${float ? " dt-pin-float" : ""}`}
        type="button"
        aria-pressed={pinnedNow}
        title={pinnedNow ? "固定を解除" : "この行を固定"}
        onClick={(e) => {
          e.stopPropagation();
          togglePin(id);
        }}
      >
        {pinnedNow ? "📌" : "📍"}
      </button>
    );
  }

  const clickable = Boolean(props.onRowClick);

  function renderRow(r: T, pinnedNow: boolean) {
    const id = String(rowId(r));
    const trCls = [clickable ? "dt-row--link" : "", pinnedNow ? "is-pinned" : "", props.rowClass?.(r) ?? ""]
      .filter(Boolean)
      .join(" ");
    return (
      <tr
        key={id}
        data-dt-row={id}
        className={trCls || undefined}
        onClick={clickable ? (e) => onRowActivate(r, e) : undefined}
      >
        {visibleCols.map((c, i) => {
          const cellCls = [c.align === "num" ? "num" : "", c.actions ? "col-actions" : "", c.cellClass ?? ""]
            .filter(Boolean)
            .join(" ");
          const inner = c.render ? c.render(r) : c.sortVal ? String(c.sortVal(r)) : "";
          return (
            <td key={c.key} className={cellCls || undefined}>
              {i === 0 && pinsEnabled ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {pinButton(id, pinnedNow, false)}
                  {inner}
                </span>
              ) : (
                inner
              )}
            </td>
          );
        })}
      </tr>
    );
  }

  function renderCard(r: T, pinnedNow: boolean) {
    const id = String(rowId(r));
    if (props.cardRaw) {
      const raw = props.cardRaw(r);
      if (!pinsEnabled) return <div key={id}>{raw}</div>;
      return (
        <div key={id} className={`dt-cardraw${pinnedNow ? " is-pinned" : ""}`}>
          {raw}
          {pinButton(id, pinnedNow, true)}
        </div>
      );
    }
    const cls = [
      "dt-card",
      pinnedNow ? "is-pinned" : "",
      clickable ? "dt-card--link" : "",
      actionsCol ? "dt-card--has-actions" : "",
      props.rowClass?.(r) ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    const acts = actionsCol?.render ? actionsCol.render(r) : null;
    return (
      <div
        key={id}
        className={cls}
        data-dt-row={id}
        role="listitem"
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? (e) => onRowActivate(r, e) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                if ((e.target as HTMLElement).closest("a,button,input,select,label")) return;
                e.preventDefault();
                props.onRowClick?.(r);
              }
            : undefined
        }
      >
        {pinButton(id, pinnedNow, true)}
        {acts && <div className="dt-card__tools">{acts}</div>}
        <div className="dt-card__body">{cardBody(r)}</div>
      </div>
    );
  }

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
          {sortableCols.length > 0 && (
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setSortOpen(true)}>
              ↕ 並び替え{sort.length > 0 && <span className="dt-badge">{sort.length}</span>}
            </button>
          )}
          {filterableCols.length > 0 && (
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setFilterOpen(true)}>
              ⧩ 絞り込み
              {Object.keys(filters).length > 0 && <span className="dt-badge">{Object.keys(filters).length}</span>}
            </button>
          )}
        </div>
        <div className="tools">
          {!useCard && (
            <button className="btn btn-outline btn-sm" type="button" ref={colBtnRef} onClick={openColMenu}>
              列設定
            </button>
          )}
          <button className="btn btn-outline btn-sm" type="button" onClick={exportCsv}>
            エクスポート
          </button>
          <span className="seg seg-density" role="group" aria-label="表示密度">
            <button className="seg__btn" type="button" aria-pressed={density === "normal"} onClick={() => setDensity("normal")}>
              標準
            </button>
            <button className="seg__btn" type="button" aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>
              コンパクト
            </button>
          </span>
          {hasCard && (
            <div className="viewtoggle" role="radiogroup" aria-label="表示切替">
              <button
                type="button"
                role="radio"
                aria-checked={view === "card"}
                className={view === "card" ? "is-on" : undefined}
                title="カード表示"
                onClick={() => setView("card")}
              >
                🔲 カード
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={view === "list"}
                className={view === "list" ? "is-on" : undefined}
                title="リスト表示"
                onClick={() => setView("list")}
              >
                ☰ リスト
              </button>
            </div>
          )}
        </div>

        {/* 適用中チップ（検索・並び替え・絞込を全て）＋右端「すべてクリア」 */}
        {(searchActive || sort.length > 0 || Object.keys(filters).length > 0) && (
          <div className="dt-chips">
            <span className="dt-chips__label">適用中:</span>
            {searchActive && (
              <span className="dt-chip">
                🔍 &quot;{searchActive}&quot;
                <button className="dt-chip__x" type="button" aria-label="検索を解除" onClick={() => { setSearch(""); setPage(1); }}>
                  ✕
                </button>
              </span>
            )}
            {sort.length > 0 && (
              <span className="dt-chip">
                並び替え: {sort.map((s) => `${labelOf(s.key)}${s.dir === "desc" ? "▼" : "▲"}`).join(" › ")}
                <button
                  className="dt-chip__x"
                  type="button"
                  aria-label="並び替えを解除"
                  onClick={() => { setSimpleSort(null); setAdvSort([]); setPage(1); }}
                >
                  ✕
                </button>
              </span>
            )}
            {Object.keys(filters).map((k) => (
              <span key={k} className="dt-chip">
                {labelOf(k)}: {filterSummary(filters[k])}
                <button
                  className="dt-chip__x"
                  type="button"
                  aria-label="絞込を解除"
                  onClick={() => { setFilters((prev) => { const n = { ...prev }; delete n[k]; return n; }); setPage(1); }}
                >
                  ✕
                </button>
              </span>
            ))}
            <button className="dt-chip dt-chip--clear" type="button" onClick={clearAll}>
              すべてクリア
            </button>
          </div>
        )}
      </div>

      {hasServer && srvError && (
        <div className="form-error" role="alert">一覧の取得に失敗しました。時間をおいて再度お試しください。</div>
      )}

      {!useCard && !isEmpty && !showLoading && (
        <div className="table-wrap dt-scroll">
          <table
            className={`table dt-fixed${density === "compact" ? " table--compact" : ""}`}
            style={{ minWidth: `${minWidthPx}px` }}
          >
            <thead ref={theadRef}>
              <tr>
                {visibleCols.map((c, idx) => {
                  const pct = colWidths[idx] ? (colWidths[idx] / sumW) * 100 : 0;
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
                      onClick={(e) => onHeaderClick(c, e)}
                    >
                      <div className="dt-th">
                        <span className="dt-th__label">{c.label}</span>
                        {c.sortable ? <span className="dt-sort-ind" /> : null}
                      </div>
                      {!c.actions && (
                        <span
                          className="dt-resizer"
                          onPointerDown={(e) => startResize(c.key, e)}
                          onDoubleClick={() => setWidths((prev) => { const n = { ...prev }; delete n[c.key]; return n; })}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {pinned.map((r) => renderRow(r, true))}
              {pageRows.map((r) => renderRow(r, false))}
            </tbody>
          </table>
        </div>
      )}
      {useCard && !isEmpty && !showLoading && (
        <div className="dt-cards" role="list">
          {pinned.map((r) => renderCard(r, true))}
          {pageRows.map((r) => renderCard(r, false))}
        </div>
      )}

      {showLoading ? (
        <div className="list-empty">読み込み中…</div>
      ) : isEmpty ? (
        <div className="list-empty">{props.emptyText ?? "該当するデータがありません。"}</div>
      ) : null}

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
              aria-label="最初のページ"
              onClick={() => setPage(1)}
            >
              «
            </button>
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
            <button
              className="btn btn-outline btn-sm"
              type="button"
              disabled={curPage >= pages}
              aria-label="最後のページ"
              onClick={() => setPage(pages)}
            >
              »
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

      {/* 列設定ポップオーバー（表示/並べ替え/幅リセット） */}
      {colMenuOpen && (
        <div className="col-menu" ref={colMenuRef} style={{ top: colMenuPos.top, left: colMenuPos.left }}>
          <div className="col-menu__title">表示する列・並び順</div>
          {order.map((k, i) => {
            const c = colByKey[k];
            if (!c) return null;
            const shown = !hidden.includes(c.key);
            return (
              <div key={c.key} className="col-menu__item">
                <label className="col-menu__grab checkbox">
                  <input
                    type="checkbox"
                    checked={shown}
                    disabled={c.locked}
                    onChange={(e) => toggleColumn(c.key, e.target.checked)}
                  />
                  <span className="col-menu__name">{c.label || "（操作）"}</span>
                  {c.locked && <span className="col-menu__lock">必須</span>}
                </label>
                <span className="col-menu__ord">
                  <button type="button" disabled={i === 0 || c.locked} aria-label="上へ" onClick={() => moveColumn(c.key, -1)}>
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={i === order.length - 1 || c.locked}
                    aria-label="下へ"
                    onClick={() => moveColumn(c.key, 1)}
                  >
                    ▼
                  </button>
                </span>
              </div>
            );
          })}
          <div className="col-menu__foot">
            <button className="btn btn-sm btn-outline" type="button" onClick={() => setWidths({})}>
              列幅をリセット
            </button>
            <button
              className="btn btn-sm btn-outline"
              type="button"
              onClick={() => {
                setOrder(defaultOrder);
                setHidden(defaultHidden);
                setWidths({});
              }}
            >
              既定に戻す
            </button>
          </div>
        </div>
      )}

      {sortableCols.length > 0 && (
        <SortBuilder
          open={sortOpen}
          onClose={() => setSortOpen(false)}
          sortable={sortableCols}
          current={advSort.length ? advSort : simpleSort ? [simpleSort] : []}
          onApply={(keys) => {
            setAdvSort(keys);
            if (keys.length) setSimpleSort(null);
            setPage(1);
            setSortOpen(false);
          }}
        />
      )}

      {filterableCols.length > 0 && (
        <FilterDialog
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          columns={filterableCols}
          current={filters}
          onApply={(next) => {
            setFilters(next);
            setPage(1);
            setFilterOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---- 並び替えビルダー（複数キー・2ペイン） ----------------------------------
function SortBuilder<T>({
  open,
  onClose,
  sortable,
  current,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  sortable: DataTableColumn<T>[];
  current: SortKey[];
  onApply: (keys: SortKey[]) => void;
}) {
  const [work, setWork] = useState<SortKey[]>(current);
  useEffect(() => {
    if (open) setWork(current.map((s) => ({ ...s })));
    // 開いた時のみ現在値で初期化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const labelOf = (k: string) => sortable.find((c) => c.key === k)?.label ?? k;
  const used = work.map((s) => s.key);
  const avail = sortable.filter((c) => !used.includes(c.key));

  return (
    <Modal open={open} onClose={onClose} title="並び替え（複数項目）" size="md">
      <ModalBody>
        <p className="admin-sub" style={{ margin: "0 0 var(--space-3)" }}>
          右の項目をクリックすると並び替え条件に追加されます。左は上ほど優先。
        </p>
        <div className="sort-builder">
          <div className="sort-builder__pane">
            <div className="sort-builder__title">並び替え条件（上ほど優先）</div>
            <ul className="sort-builder__list">
              {work.length === 0 ? (
                <li className="sort-builder__empty">条件なし（右から追加）</li>
              ) : (
                work.map((s, i) => (
                  <li key={s.key} className="sort-key">
                    <span className="sort-key__ord">
                      <button
                        type="button"
                        disabled={i === 0}
                        aria-label="上へ"
                        onClick={() => setWork((w) => swap(w, i, i - 1))}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={i === work.length - 1}
                        aria-label="下へ"
                        onClick={() => setWork((w) => swap(w, i, i + 1))}
                      >
                        ▼
                      </button>
                    </span>
                    <span className="sort-key__pri">{i + 1}</span>
                    <span className="sort-key__name" title={labelOf(s.key)}>
                      {labelOf(s.key)}
                    </span>
                    <span className="seg">
                      <button
                        type="button"
                        className="seg__btn"
                        aria-pressed={s.dir === "asc"}
                        onClick={() => setWork((w) => w.map((x) => (x.key === s.key ? { ...x, dir: "asc" } : x)))}
                      >
                        昇順
                      </button>
                      <button
                        type="button"
                        className="seg__btn"
                        aria-pressed={s.dir === "desc"}
                        onClick={() => setWork((w) => w.map((x) => (x.key === s.key ? { ...x, dir: "desc" } : x)))}
                      >
                        降順
                      </button>
                    </span>
                    <button
                      type="button"
                      className="sort-key__x"
                      aria-label="除外"
                      onClick={() => setWork((w) => w.filter((x) => x.key !== s.key))}
                    >
                      ✕
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="sort-builder__pane">
            <div className="sort-builder__title">対象外の項目</div>
            <ul className="sort-builder__list">
              {avail.length === 0 ? (
                <li className="sort-builder__empty">すべて条件に追加済み</li>
              ) : (
                avail.map((c) => (
                  <li
                    key={c.key}
                    className="sort-avail"
                    onClick={() => setWork((w) => [...w, { key: c.key, dir: "asc" }])}
                  >
                    <span title={c.label}>{c.label}</span>
                    <span className="sort-avail__add">＋ 追加</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <button className="btn btn-outline" type="button" onClick={() => setWork([])}>
          この条件をクリア
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline" type="button" onClick={onClose}>
          キャンセル
        </button>
        <button className="btn btn-primary" type="button" onClick={() => onApply(work)}>
          適用する
        </button>
      </ModalFooter>
    </Modal>
  );
}

function swap<X>(arr: X[], i: number, j: number): X[] {
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// ---- 絞り込みダイアログ（項目別） ------------------------------------------
function FilterDialog<T>({
  open,
  onClose,
  columns,
  current,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  columns: DataTableColumn<T>[];
  current: Record<string, FilterCond>;
  onApply: (next: Record<string, FilterCond>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, FilterCond>>(current);
  useEffect(() => {
    if (open) setDraft({ ...current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setCond(key: string, cond: FilterCond | null) {
    setDraft((prev) => {
      const n = { ...prev };
      if (cond) n[key] = cond;
      else delete n[key];
      return n;
    });
  }

  function apply() {
    // 空条件は落とす。
    const next: Record<string, FilterCond> = {};
    for (const key of Object.keys(draft)) {
      const c = draft[key];
      if (c.type === "text" && c.q.trim()) next[key] = { ...c, q: c.q.trim() };
      else if (c.type === "enum" && c.values.length) next[key] = c;
      else if (c.type === "number" && (c.min != null || c.max != null)) next[key] = c;
      else if (c.type === "date" && (c.from || c.to)) next[key] = c;
    }
    onApply(next);
  }

  return (
    <Modal open={open} onClose={onClose} title="絞り込み" size="md">
      <ModalBody>
        <div className="filter-form">
          {columns.map((c) => {
            const f = c.filter!;
            const cur = draft[c.key];
            return (
              <div key={c.key} className="filter-row">
                <label>{c.label}</label>
                {f.type === "text" && (
                  <input
                    className="input"
                    placeholder="含む文字"
                    value={cur?.type === "text" ? cur.q : ""}
                    onChange={(e) => setCond(c.key, { type: "text", key: c.key, q: e.target.value })}
                  />
                )}
                {f.type === "enum" && (
                  <div className="filter-checks">
                    {f.options.map((o) => {
                      const values = cur?.type === "enum" ? cur.values : [];
                      const checked = values.includes(o[0]);
                      return (
                        <label key={o[0]} className="checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nextVals = e.target.checked ? [...values, o[0]] : values.filter((v) => v !== o[0]);
                              setCond(c.key, nextVals.length ? { type: "enum", key: c.key, values: nextVals } : null);
                            }}
                          />{" "}
                          {o[1]}
                        </label>
                      );
                    })}
                  </div>
                )}
                {f.type === "number" && (
                  <div className="filter-range">
                    <input
                      className="input"
                      type="number"
                      placeholder="最小"
                      value={cur?.type === "number" && cur.min != null ? cur.min : ""}
                      onChange={(e) =>
                        setCond(c.key, {
                          type: "number",
                          key: c.key,
                          min: e.target.value === "" ? null : Number(e.target.value),
                          max: cur?.type === "number" ? cur.max : null,
                        })
                      }
                    />
                    <span>〜</span>
                    <input
                      className="input"
                      type="number"
                      placeholder="最大"
                      value={cur?.type === "number" && cur.max != null ? cur.max : ""}
                      onChange={(e) =>
                        setCond(c.key, {
                          type: "number",
                          key: c.key,
                          min: cur?.type === "number" ? cur.min : null,
                          max: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                )}
                {f.type === "date" && (
                  <div className="filter-range">
                    <input
                      className="input"
                      type="date"
                      value={cur?.type === "date" ? cur.from : ""}
                      onChange={(e) =>
                        setCond(c.key, { type: "date", key: c.key, from: e.target.value, to: cur?.type === "date" ? cur.to : "" })
                      }
                    />
                    <span>〜</span>
                    <input
                      className="input"
                      type="date"
                      value={cur?.type === "date" ? cur.to : ""}
                      onChange={(e) =>
                        setCond(c.key, { type: "date", key: c.key, from: cur?.type === "date" ? cur.from : "", to: e.target.value })
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ModalBody>
      <ModalFooter>
        <button className="btn btn-outline" type="button" onClick={() => setDraft({})}>
          クリア
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline" type="button" onClick={onClose}>
          キャンセル
        </button>
        <button className="btn btn-primary" type="button" onClick={apply}>
          適用する
        </button>
      </ModalFooter>
    </Modal>
  );
}
