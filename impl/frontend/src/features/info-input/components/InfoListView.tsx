"use client";

// SC-50 情報インプット 一覧。レイアウト/クラスの正＝doc/画面設計/mocks/SC-50_情報インプット.html（DoD＝モック一致）。
// 一覧の操作標準は DataTable に委譲（検索/絞込/複数ソート/列設定/CSV/ピン/カード／subRow で要約2行）。
// 状態タブ（すべて/未判定/判定済）＋続報を束ねる（roots_only）はクライアント絞込（将来はサーバー委譲＝§4.1）。
// 登録/詳細/編集は URL 付きモーダル（別ルート）へ。データ源は api.ts（当面 fixtures・INFO_CHANGED_EVENT で再取得）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Avatar, DataTable, RowMenu, useConfirm } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import {
  archiveInfoItem, deleteInfoItem, followUps, INFO_CHANGED_EVENT, listInfoItems, rootOf,
} from "../api";
import {
  CATEGORY_LABEL, IMPACT_CLASS_LABEL, LINK_TARGET_LABEL, PRIORITY_LABEL, SOURCE_LABEL, STATUS_LABEL,
} from "../labels";
import type { InfoItem, InfoStatusFilter } from "../types";
import "../info-input.css";

// 集約ワードクラウド（デモ＝トークン頻度。本番＝GET /info-items/word-cloud）。
const WORD_CLOUD: [string, number][] = [
  ["生成AI", 24], ["ガイドライン", 9], ["競合", 14], ["値下げ", 7], ["ノーコード", 6],
  ["画像処理", 11], ["DX", 8], ["採算", 5], ["導入率", 6], ["要約", 4],
];

const summaryText = (r: InfoItem) =>
  r.summary || r.body_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

export function InfoListView() {
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState<InfoItem[]>([]);
  const [status, setStatus] = useState<InfoStatusFilter>("all");
  const [rootsOnly, setRootsOnly] = useState(false);
  const [fts, setFts] = useState(""); // 全文検索（タイトル＋本文＋要約）＝標準の横断検索/絞込とは別建て（本番は ?q= PGroonga §N）
  const [followMap, setFollowMap] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    const data = await listInfoItems();
    setItems(data);
    const fm: Record<string, number> = {};
    data.forEach((x) => { if (x.parent_info_id) fm[x.parent_info_id] = (fm[x.parent_info_id] ?? 0) + 1; });
    setFollowMap(fm);
  }, []);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener(INFO_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INFO_CHANGED_EVENT, onChanged);
  }, [reload]);

  const active = useMemo(() => items.filter((x) => x.status !== "archived"), [items]);
  const counts = useMemo(
    () => ({
      all: active.length,
      raw: active.filter((x) => x.status === "raw").length,
      curated: active.filter((x) => x.status === "curated").length,
    }),
    [active],
  );
  const rows = useMemo(() => {
    let data = active;
    if (status !== "all") data = data.filter((x) => x.status === status);
    if (rootsOnly) data = data.filter((x) => !x.parent_info_id);
    const q = fts.trim().toLowerCase();
    if (q) data = data.filter((x) => `${x.title} ${x.summary ?? ""} ${x.body_html.replace(/<[^>]+>/g, " ")}`.toLowerCase().includes(q));
    return data;
  }, [active, status, rootsOnly, fts]);

  const titleById = useCallback((id: string) => items.find((x) => x.id === id)?.title ?? "—", [items]);

  const menuItems = useCallback(
    (r: InfoItem): RowMenuItem[] => {
      const inThread = Boolean(r.parent_info_id) || (followMap[r.id] ?? 0) > 0;
      const list: RowMenuItem[] = [
        { label: "詳細を開く", onClick: () => router.push(`/info-items/${r.id}`) },
      ];
      if (inThread) list.push({ label: "🧵 スレッドを見る（時系列）", onClick: () => router.push(`/info-items/${rootOf(r).id}`) });
      list.push({ label: "続報を登録", onClick: () => router.push(`/info-items/new?parent=${r.id}`) });
      list.push({ label: "属性を編集", onClick: () => router.push(`/info-items/${r.id}/edit`) });
      if (r.status === "raw") {
        list.push({
          label: "削除（未判定）", danger: true,
          onClick: async () => {
            const ok = await confirm({ title: "情報を削除", msg: `未判定の「${r.title}」を削除しますか？（登録者本人の raw のみ物理削除可）`, variant: "danger" });
            if (ok) deleteInfoItem(r.id);
          },
        });
      } else {
        list.push({
          label: "アーカイブ",
          onClick: async () => {
            const ok = await confirm({ title: "アーカイブ", msg: `「${r.title}」をアーカイブしますか？（論理削除・監査保持）` });
            if (ok) archiveInfoItem(r.id);
          },
        });
      }
      return list;
    },
    [router, confirm, followMap],
  );

  const columns: DataTableColumn<InfoItem>[] = useMemo(
    () => [
      {
        key: "title", label: "タイトル / 要約", locked: true, width: 720, sortable: true, filter: { type: "text" },
        // 標準の横断検索は表示テキスト（タイトル・要約）まで。本文は上部の「全文検索」バー（q）で別建て。
        sortVal: (r) => r.title, searchVal: (r) => `${r.title} ${r.summary ?? ""}`,
        csvVal: (r) => r.title,
        render: (r) => {
          const fu = followMap[r.id] ?? 0;
          return (
            <span>
              {r.parent_info_id ? <span className="thread-badge">↳続報 </span> : null}
              <strong>{r.title}</strong>
              {fu > 0 ? <span className="thread-badge"> 🧵{fu}</span> : null}
            </span>
          );
        },
      },
      {
        key: "status", label: "状態", width: 110, sortable: true,
        filter: { type: "enum", options: Object.entries(STATUS_LABEL).map(([v, l]) => [v, l[0]] as [string, string]) },
        sortVal: (r) => r.status, filterVal: (r) => r.status, csvVal: (r) => STATUS_LABEL[r.status][0],
        render: (r) => <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>,
      },
      {
        key: "priority", label: "優先度", width: 120, sortable: true,
        filter: { type: "enum", options: Object.entries(PRIORITY_LABEL) },
        sortVal: (r) => r.priority ?? "", filterVal: (r) => r.priority ?? "", csvVal: (r) => (r.priority ? PRIORITY_LABEL[r.priority] : ""),
        render: (r) => (r.priority ? <span title={PRIORITY_LABEL[r.priority]}>{PRIORITY_LABEL[r.priority]}</span> : <span className="muted">—</span>),
      },
      {
        key: "impact_class", label: "影響分類", width: 140, sortable: true,
        filter: { type: "enum", options: Object.entries(IMPACT_CLASS_LABEL).map(([v, l]) => [v, l[0]] as [string, string]) },
        sortVal: (r) => r.impact_class ?? "", filterVal: (r) => r.impact_class ?? "", csvVal: (r) => (r.impact_class ? IMPACT_CLASS_LABEL[r.impact_class][0] : ""),
        render: (r) => (r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`} title={IMPACT_CLASS_LABEL[r.impact_class][0]}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : <span className="muted">—</span>),
      },
      {
        key: "categories", label: "情報カテゴリ", width: 260,
        csvVal: (r) => r.categories.map((c) => CATEGORY_LABEL[c]).join("、"),
        render: (r) => (r.categories.length ? <span className="cell-tags">{r.categories.map((c) => <span key={c} className="badge badge-muted">{CATEGORY_LABEL[c]}</span>)}</span> : <span className="muted">—</span>),
      },
      {
        key: "source", label: "情報ソース", width: 220, sortable: true,
        filter: { type: "enum", options: Object.entries(SOURCE_LABEL) },
        sortVal: (r) => r.source ?? "", filterVal: (r) => r.source ?? "", csvVal: (r) => (r.source ? SOURCE_LABEL[r.source] : ""),
        render: (r) => (r.source ? <span className="cell-clip" title={SOURCE_LABEL[r.source]}>{SOURCE_LABEL[r.source]}</span> : <span className="muted">—</span>),
      },
      {
        key: "due_date", label: "期限日", width: 140, sortable: true, filter: { type: "date" },
        sortVal: (r) => r.due_date ?? "", filterVal: (r) => r.due_date ?? "", csvVal: (r) => r.due_date ?? "",
        render: (r) => (r.due_date ? <span title={r.due_date}>{r.due_date}</span> : <span className="muted">—</span>),
      },
      {
        key: "links", label: "💡", width: 84, sortable: true, sortVal: (r) => r.links.length, csvVal: (r) => String(r.links.length),
        render: (r) => (r.links.length ? <span className="badge badge-muted" title={`関連リンク ${r.links.length} 件`}>{r.links.length}</span> : <span className="muted">0</span>),
      },
      {
        key: "created_by", label: "登録者", width: 180, sortable: true, filter: { type: "text" },
        sortVal: (r) => r.created_by, searchVal: (r) => r.created_by, csvVal: (r) => r.created_by,
        render: (r) => <span className="cell-clip" style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }} title={r.created_by}><Avatar name={r.created_by} size="sm" />{r.created_by}</span>,
      },
      {
        key: "created_at", label: "登録日", width: 150, sortable: true, filter: { type: "date" },
        sortVal: (r) => r.created_at, filterVal: (r) => r.created_at, csvVal: (r) => r.created_at,
        render: (r) => <span title={r.created_at}>{r.created_at}</span>,
      },
      { key: "_actions", label: "", actions: true, locked: true, width: 80, render: (r) => <RowMenu items={menuItems(r)} /> },
    ],
    [followMap, menuItems],
  );

  const subRow = useCallback(
    (r: InfoItem) => {
      const lineage = r.parent_info_id ? <span style={{ color: "var(--color-primary)", marginRight: 8 }}>↳ 元：{titleById(r.parent_info_id)} の続報</span> : null;
      const s = summaryText(r);
      const sum = s ? <><span style={{ color: "var(--color-text-subtle)", marginRight: 6 }}>要約</span>{s}</> : null;
      if (!lineage && !sum) return null;
      return <>{lineage}{sum}</>;
    },
    [titleById],
  );

  const card = useCallback(
    (r: InfoItem) => {
      const fu = followMap[r.id] ?? 0;
      const s = summaryText(r);
      return (
        <>
          <div className="dt-card__title">
            {r.parent_info_id ? <span className="thread-badge">↳続報 </span> : null}
            {r.title}
            {fu > 0 ? <span className="thread-badge"> 🧵{fu}</span> : null}
          </div>
          {r.parent_info_id ? <div className="thread-badge" style={{ color: "var(--color-primary)", marginBottom: 4 }}>↳ 元：{titleById(r.parent_info_id)} の続報</div> : null}
          <div className="dt-card__meta">
            <span className={`badge ${STATUS_LABEL[r.status][1]}`}>{STATUS_LABEL[r.status][0]}</span>
            {r.impact_class ? <span className={`badge ${IMPACT_CLASS_LABEL[r.impact_class][1]}`}>{IMPACT_CLASS_LABEL[r.impact_class][0]}</span> : null}
            {r.priority ? <span className="badge badge-muted">優先度 {PRIORITY_LABEL[r.priority]}</span> : null}
            <span>{r.created_by}</span>
            <span>{r.created_at}</span>
          </div>
          {s ? <div className="dt-card__stats"><span><span style={{ color: "var(--color-text-subtle)", marginRight: 6 }}>要約</span>{s}</span></div> : null}
        </>
      );
    },
    [followMap, titleById],
  );

  return (
    <div className="info-page">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="page-title">情報インプット</h1>
      <p className="admin-sub">外部WEB情報を<strong>手動で貼り付けて登録</strong>し、属性を付け、アイデア／コンセプト／クエストへ<strong>動的に関連づけ</strong>る会社横断の知識レイヤ。登録は<strong>全員</strong>／属性付与・判定は<strong>情報判定権限（info_curator）</strong>。</p>

      <div className="info-fts" role="search">
        <label className="info-fts__label" htmlFor="info-fts-input">🔍 全文検索</label>
        <div className="info-fts__box">
          <input id="info-fts-input" className="input" type="search" value={fts} onChange={(e) => setFts(e.target.value)}
            placeholder="タイトル・本文・要約を横断検索…（例: ガイドライン）" aria-describedby="info-fts-hint" />
          {fts ? <button type="button" className="info-fts__clear" onClick={() => setFts("")} aria-label="全文検索をクリア">✕</button> : null}
        </div>
        <span id="info-fts-hint" className="info-fts__hint">本文テキストまで対象の全文検索（本番は PGroonga <code>?q=</code>）。表の<strong>検索・列フィルタ</strong>は表示項目に対する標準の絞込です。</span>
      </div>

      <div className="wordcloud" aria-label="ワードクラウド（語で絞り込み）">
        <div className="wordcloud__title">☁️ よく出る語</div>
        {WORD_CLOUD.map(([w, c]) => {
          const max = Math.max(...WORD_CLOUD.map((x) => x[1]));
          return <span key={w} className="wc-word" style={{ fontSize: `${(0.85 + (c / max) * 1.1).toFixed(2)}rem`, opacity: (0.55 + (c / max) * 0.45).toFixed(2) }} title={`${w}（${c}）`}>{w}</span>;
        })}
      </div>

      <div className="section-head">
        <h2>情報一覧</h2>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <label className="checkbox" style={{ fontSize: "var(--text-sm)" }}>
            <input type="checkbox" checked={rootsOnly} onChange={(e) => setRootsOnly(e.target.checked)} /><span>続報を束ねる</span>
          </label>
          <Link className="btn btn-primary" href="/info-items/new">＋ 情報を登録</Link>
        </div>
      </div>

      <div className="segmented idea-filter" role="radiogroup" aria-label="判定状態で絞り込み" style={{ marginBottom: "var(--space-3)" }}>
        {([["all", "すべて", counts.all], ["raw", "未判定", counts.raw], ["curated", "判定済", counts.curated]] as const).map(([k, label, n]) => (
          <label key={k}>
            <input type="radio" name="info-status" checked={status === k} onChange={() => setStatus(k)} />
            {label} <span className="idea-filter__n">{n}</span>
          </label>
        ))}
      </div>

      <DataTable<InfoItem>
        storageKey="sc50-info"
        data={rows}
        rowId={(r) => r.id}
        unit="件"
        perPage={10}
        perPageOptions={[10, 20, 50]}
        searchFields="タイトル・要約・作成者"
        searchPlaceholder="一覧を絞り込み（タイトル・要約・作成者）…"
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
    </div>
  );
}
