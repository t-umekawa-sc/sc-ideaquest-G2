"use client";

// SC-50 情報インプット 一覧。レイアウト/クラスの正＝doc/画面設計/mocks/SC-50_情報インプット.html（DoD＝モック一致）。
// 一覧はサーバー委譲（GET /info-items・DataTable §1.8.1・番号ページャ）＝検索/絞込/複数ソート/ページはサーバーが確定。
// 状態タブ（すべて/未判定/判定済＝server status＋件数は facets）／続報を束ねる（roots_only）もサーバー委譲。
// 登録/詳細/編集は URL 付きモーダル（別ルート・当面 fixtures＝Phase B/C で結線）。ワードクラウド/全文検索はサーバー。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Avatar, DataTable, RowMenu, useConfirm } from "@/components/ui";
import type { DataTableColumn, QueryState, RowMenuItem, ServerResult } from "@/components/ui";
import {
  archiveInfoItem, deleteInfoItem, fetchInfoItems, fetchWordCloud, INFO_CHANGED_EVENT, searchInfoItems,
} from "../api";
import {
  CATEGORY_LABEL, IMPACT_CLASS_LABEL, PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL,
} from "../labels";
import type { InfoCard, InfoStatusFacets, InfoStatusFilter, WordCloudToken } from "../types";
import "../info-input.css";

const summaryText = (r: InfoCard) => r.summary ?? "";

// --- 全文検索タブ（クエスト SC-12 の全文検索と同じ体裁＝件数＋ハイライトスニペット。対象＝サーバー q＝title＋本文）。 ---
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 一致箇所の周辺を切り出し、キーワードを <mark> でハイライト（dangerouslySetInnerHTML は使わない・§2.2④）。
function snippetNodes(text: string, q: string, span = 140): ReactNode {
  if (!text) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  let start = 0, body = text;
  if (idx >= 0) {
    start = Math.max(0, idx - 40);
    body = text.slice(start, start + span);
  } else {
    body = text.slice(0, span);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = start + span < text.length ? "…" : "";
  const parts = body.split(new RegExp(`(${escapeRe(q)})`, "ig"));
  return (
    <>
      {prefix}
      {parts.map((seg, i) => (seg.toLowerCase() === q.toLowerCase() ? <mark key={i} className="keyword">{seg}</mark> : <span key={i}>{seg}</span>))}
      {suffix}
    </>
  );
}

const EMPTY_FACETS: InfoStatusFacets = { all: 0, raw: 0, curated: 0 };

export function InfoListView() {
  const router = useRouter();
  const confirm = useConfirm();
  const [status, setStatus] = useState<InfoStatusFilter>("all");
  const [rootsOnly, setRootsOnly] = useState(false);
  const [tab, setTab] = useState<"list" | "search">("list"); // 一覧／全文検索（クエスト SC-12 と同じタブ構成）
  const [facets, setFacets] = useState<InfoStatusFacets>(EMPTY_FACETS); // 状態タブの件数バッジ（サーバー集計）
  const [refreshToken, setRefreshToken] = useState(0); // 外部変更で再クエリ
  const [wordCloud, setWordCloud] = useState<WordCloudToken[]>([]);
  const [fts, setFts] = useState(""); // 全文検索クエリ（サーバー q＝title＋本文）
  const [ftResults, setFtResults] = useState<InfoCard[]>([]);
  const [ftLoading, setFtLoading] = useState(false);

  // 外部変更（登録/編集＝Phase C で結線後）で一覧・ワードクラウドを再取得。
  useEffect(() => {
    const onChanged = () => setRefreshToken((n) => n + 1);
    window.addEventListener(INFO_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INFO_CHANGED_EVENT, onChanged);
  }, []);

  // ワードクラウド（会社横断の語の俯瞰・GET /info-items/word-cloud）。
  useEffect(() => {
    const ac = new AbortController();
    void fetchWordCloud(40, ac.signal).then(setWordCloud).catch(() => {});
    return () => ac.abort();
  }, [refreshToken]);

  // 一覧のサーバークエリ（DataTable が state 変化ごとに呼ぶ）。status/rootsOnly/refreshToken を反映＝依存に含める。
  const serverQuery = useCallback(
    async (state: QueryState, signal: AbortSignal): Promise<ServerResult<InfoCard>> => {
      const res = await fetchInfoItems(state, { status, rootsOnly }, signal);
      if (!res) return { rows: [], total: 0, pinned: [] };
      setFacets(res.facets ?? EMPTY_FACETS);
      return { rows: res.data, total: res.page_info.total, pinned: [] };
    },
    [status, rootsOnly, refreshToken],
  );

  // 全文検索タブ（サーバー q）。
  useEffect(() => {
    const q = fts.trim();
    if (tab !== "search" || !q) { setFtResults([]); setFtLoading(false); return; }
    const ac = new AbortController();
    setFtLoading(true);
    void searchInfoItems(q, ac.signal)
      .then((rows) => { setFtResults(rows); setFtLoading(false); })
      .catch(() => setFtLoading(false));
    return () => ac.abort();
  }, [fts, tab, refreshToken]);

  const menuItems = useCallback(
    (r: InfoCard): RowMenuItem[] => {
      const inThread = Boolean(r.parent_info_id) || r.follow_up_count > 0;
      const rootId = r.parent_info_id ?? r.id;
      const list: RowMenuItem[] = [
        { label: "詳細を開く", onClick: () => router.push(`/info-items/${r.id}`) },
      ];
      if (inThread) list.push({ label: "🧵 スレッドを見る（時系列）", onClick: () => router.push(`/info-items/${rootId}`) });
      list.push({ label: "続報を登録", onClick: () => router.push(`/info-items/new?parent=${r.id}`) });
      list.push({ label: "属性を編集", onClick: () => router.push(`/info-items/${r.id}/edit`) });
      if (r.status === "raw") {
        list.push({
          label: "削除（未判定）", danger: true,
          onClick: async () => {
            const ok = await confirm({ title: "情報を削除", msg: `未判定の「${r.title}」を削除しますか？（登録者本人の raw のみ物理削除可）`, variant: "danger" });
            if (ok) { deleteInfoItem(r.id); setRefreshToken((n) => n + 1); }
          },
        });
      } else {
        list.push({
          label: "アーカイブ",
          onClick: async () => {
            const ok = await confirm({ title: "アーカイブ", msg: `「${r.title}」をアーカイブしますか？（論理削除・監査保持）` });
            if (ok) { archiveInfoItem(r.id); setRefreshToken((n) => n + 1); }
          },
        });
      }
      return list;
    },
    [router, confirm],
  );

  const columns: DataTableColumn<InfoCard>[] = useMemo(
    () => [
      {
        key: "title", label: "タイトル / 要約", locked: true, width: 720, sortable: true,
        // 横断検索（上部）は server q＝title＋本文（全文）。searchVal は表示補助（server 側で確定）。
        sortVal: (r) => r.title, searchVal: (r) => `${r.title} ${r.summary ?? ""}`, csvVal: (r) => r.title,
        render: (r) => (
          <span>
            {r.parent_info_id ? <span className="thread-badge">↳続報 </span> : null}
            <strong>{r.title}</strong>
            {r.follow_up_count > 0 ? <span className="thread-badge"> 🧵{r.follow_up_count}</span> : null}
          </span>
        ),
      },
      {
        key: "status", label: "状態", width: 110, sortable: true,
        sortVal: (r) => r.status, csvVal: (r) => STATUS_LABEL[r.status][0],
        render: (r) => <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>,
      },
      {
        key: "priority", label: "優先度", width: 120, sortable: true,
        filter: { type: "enum", options: Object.entries(PRIORITY_LABEL) },
        sortVal: (r) => r.priority ?? "", filterVal: (r) => r.priority ?? "", csvVal: (r) => (r.priority ? PRIORITY_LABEL[r.priority] : ""),
        render: (r) => (r.priority ? <span title={PRIORITY_LABEL[r.priority]}>{PRIORITY_LABEL[r.priority]}</span> : <span className="muted">—</span>),
      },
      {
        key: "impact_class", label: "影響分類", width: 140,
        filter: { type: "enum", options: Object.entries(IMPACT_CLASS_LABEL).map(([v, l]) => [v, l[0]] as [string, string]) },
        filterVal: (r) => r.impact_class ?? "", csvVal: (r) => (r.impact_class ? IMPACT_CLASS_LABEL[r.impact_class][0] : ""),
        render: (r) => (r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`} title={IMPACT_CLASS_LABEL[r.impact_class][0]}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : <span className="muted">—</span>),
      },
      {
        key: "categories", label: "情報カテゴリ", width: 260,
        csvVal: (r) => r.categories.map((c) => CATEGORY_LABEL[c] ?? c).join("、"),
        render: (r) => (r.categories.length ? <span className="cell-tags">{r.categories.map((c) => <span key={c} className="badge badge-muted">{CATEGORY_LABEL[c] ?? c}</span>)}</span> : <span className="muted">—</span>),
      },
      {
        key: "source", label: "情報ソース", width: 220,
        filter: { type: "enum", options: Object.entries(SOURCE_LABEL) },
        filterVal: (r) => r.source ?? "", csvVal: (r) => (r.source ? SOURCE_LABEL[r.source] : ""),
        render: (r) => (r.source ? <span className="cell-clip" title={SOURCE_LABEL[r.source]}>{SOURCE_LABEL[r.source]}</span> : <span className="muted">—</span>),
      },
      {
        key: "due_date", label: "期限日", width: 140, sortable: true,
        sortVal: (r) => r.due_date ?? "", csvVal: (r) => r.due_date ?? "",
        render: (r) => (r.due_date ? <span title={r.due_date}>{r.due_date}</span> : <span className="muted">—</span>),
      },
      {
        key: "link_count", label: "💡", width: 84, sortable: true, sortVal: (r) => r.link_count, csvVal: (r) => String(r.link_count),
        render: (r) => (r.link_count ? <span className="badge badge-muted" title={`関連リンク ${r.link_count} 件`}>{r.link_count}</span> : <span className="muted">0</span>),
      },
      {
        key: "created_by", label: "登録者", width: 180,
        csvVal: (r) => r.created_by.display_name,
        render: (r) => <span className="cell-clip" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }} title={r.created_by.display_name}><Avatar name={r.created_by.display_name} imageUrl={r.created_by.avatar_image_url ?? undefined} size="sm" />{r.created_by.display_name}</span>,
      },
      {
        key: "created_at", label: "登録日", width: 150, sortable: true,
        sortVal: (r) => r.created_at, csvVal: (r) => r.created_at,
        render: (r) => <span title={r.created_at}>{r.created_at.slice(0, 10)}</span>,
      },
      { key: "_actions", label: "", actions: true, locked: true, width: 80, render: (r) => <RowMenu items={menuItems(r)} /> },
    ],
    [menuItems],
  );

  const subRow = useCallback((r: InfoCard) => {
    const lineage = r.parent_info_id ? <span style={{ color: "var(--color-primary)", marginRight: 8 }}>↳ 続報（元の情報あり）</span> : null;
    const s = summaryText(r);
    const sum = s ? <><span style={{ color: "var(--color-text-subtle)", marginRight: 6 }}>要約</span>{s}</> : null;
    if (!lineage && !sum) return null;
    return <>{lineage}{sum}</>;
  }, []);

  const card = useCallback((r: InfoCard) => {
    const s = summaryText(r);
    return (
      <>
        <div className="dt-card__title">
          {r.parent_info_id ? <span className="thread-badge">↳続報 </span> : null}
          {r.title}
          {r.follow_up_count > 0 ? <span className="thread-badge"> 🧵{r.follow_up_count}</span> : null}
        </div>
        <div className="dt-card__meta">
          <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>
          {r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : null}
          {r.priority ? <span className="badge badge-muted">優先度 {PRIORITY_LABEL[r.priority]}</span> : null}
          <span>{r.created_by.display_name}</span>
          <span>{r.created_at.slice(0, 10)}</span>
        </div>
        {s ? <div className="dt-card__stats"><span><span style={{ color: "var(--color-text-subtle)", marginRight: 6 }}>要約</span>{s}</span></div> : null}
      </>
    );
  }, []);

  return (
    <div className="info-page">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head"><h1>情報インプット</h1></div>
      <p className="admin-sub">外部WEB情報を<strong>手動で貼り付けて登録</strong>し、属性を付け、アイデア／コンセプト／クエストへ<strong>動的に関連づけ</strong>る会社横断の知識レイヤ。登録は<strong>全員</strong>／属性付与・判定は<strong>情報判定権限（info_curator）</strong>。</p>

      {/* ワードクラウドはタブの外（常時表示）＝会社横断の語の俯瞰（GET /info-items/word-cloud）。語クリックで全文検索へ。 */}
      {wordCloud.length > 0 && (
        <div className="wordcloud" aria-label="ワードクラウド（語で絞り込み）">
          <div className="wordcloud__title">☁️ よく出る語</div>
          {wordCloud.map(({ token, count }) => {
            const max = Math.max(...wordCloud.map((x) => x.count));
            return (
              <button key={token} type="button" className="wc-word"
                style={{ fontSize: `${(0.85 + (count / max) * 1.1).toFixed(2)}rem`, opacity: (0.55 + (count / max) * 0.45).toFixed(2) }}
                title={`${token}（${count}）で全文検索`}
                onClick={() => { setTab("search"); setFts(token); }}>{token}</button>
            );
          })}
        </div>
      )}

      {/* タブ＝クエスト SC-12 と同じ体裁（情報インプット＝一覧／全文検索）。 */}
      <div className="tabs" role="tablist" aria-label="情報インプットのセクション">
        <button className={`tab${tab === "list" ? " is-active" : ""}`} role="tab" aria-selected={tab === "list"} onClick={() => setTab("list")}>
          🧭 情報インプット<span className="tab-count">{facets.all}</span>
        </button>
        <button className={`tab${tab === "search" ? " is-active" : ""}`} role="tab" aria-selected={tab === "search"} onClick={() => setTab("search")}>
          🔍 全文検索{fts.trim() ? <span className="tab-count">{ftResults.length}</span> : null}
        </button>
      </div>

      {tab === "list" && (
        <>
          <div className="section-head">
            <h2>情報一覧</h2>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <label className="checkbox" style={{ fontSize: "var(--text-sm)" }}>
                <input type="checkbox" checked={rootsOnly} onChange={(e) => { setRootsOnly(e.target.checked); setRefreshToken((n) => n + 1); }} /><span>続報を束ねる</span>
              </label>
              <Link className="btn btn-primary" href="/info-items/new">＋ 情報を登録</Link>
            </div>
          </div>

          <div className="segmented idea-filter" role="radiogroup" aria-label="判定状態で絞り込み" style={{ marginBottom: "var(--space-3)" }}>
            {([["all", "すべて", facets.all], ["raw", "未判定", facets.raw], ["curated", "判定済", facets.curated]] as const).map(([k, label, n]) => (
              <label key={k}>
                <input type="radio" name="info-status" checked={status === k} onChange={() => { setStatus(k); setRefreshToken((n) => n + 1); }} />
                {label} <span className="idea-filter__n">{n}</span>
              </label>
            ))}
          </div>

          <DataTable<InfoCard>
            storageKey="sc50-info"
            server={{ query: serverQuery }}
            refreshToken={refreshToken}
            rowId={(r) => r.id}
            unit="件"
            perPage={10}
            perPageOptions={[10, 20, 50]}
            searchFields="タイトル・本文（全文）"
            searchPlaceholder="全文で絞り込み（タイトル・本文）…"
            exportName="情報インプット"
            emptyText="該当する情報がありません。"
            onRowClick={(r) => router.push(`/info-items/${r.id}`)}
            subRow={subRow}
            card={card}
            columns={columns}
          />

          <p className="role-note" style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
            低摩擦登録（タイトル＋本文＋出典URL）は<strong>会社内の全員</strong>ができます（状態＝未判定 raw）。<strong>属性付与・環境スキャン・トリアージ判定・アーカイブ</strong>は<strong>情報判定権限（info_curator）</strong>の領分です。
          </p>
        </>
      )}

      {tab === "search" && (
        <section aria-label="全文検索">
          <p className="admin-sub" style={{ marginTop: 0 }}>
            <strong>タイトル・本文</strong>を対象としたサーバー全文検索（PGroonga <code>?q=</code>）。一覧タブの列フィルタは<strong>表示項目に対する標準の絞込</strong>です。
          </p>
          <div className="list-toolbar">
            <div className="filters">
              <input className="input ft-q" type="search" placeholder="キーワードで全文検索（例: ガイドライン）" aria-label="全文検索" value={fts} onChange={(e) => setFts(e.target.value)} />
            </div>
            {fts.trim() ? <span className="list-count">{ftResults.length} 件</span> : null}
          </div>
          {!fts.trim() ? (
            <div className="list-empty">キーワードを入力してください（会社横断の情報のタイトル・本文を全文検索します）。</div>
          ) : ftLoading ? (
            <div className="list-empty">検索中…</div>
          ) : ftResults.length === 0 ? (
            <div className="list-empty">「{fts.trim()}」に一致する結果がありません。</div>
          ) : (
            <div className="stack">
              {ftResults.map((r) => (
                <Link key={r.id} className="card card-accent ft-result" href={`/info-items/${r.id}`}>
                  <div className="ft-result__head">
                    <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>
                    {r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : null}
                    <span className="ft-result__ctx">{r.title}</span>
                  </div>
                  <p className="ft-result__snippet"><span className="muted" style={{ marginRight: 6 }}>要約</span>{snippetNodes(r.summary ?? "", fts.trim())}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
