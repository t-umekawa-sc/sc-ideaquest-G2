"use client";

// SC-80 経営資料 一覧（ドメイン R・FR-44・管理者）。サーバー委譲（GET /strategy-documents・DataTable §1.8.1）。
// 「＋ 経営資料を登録」＝URL 付きモーダル（/strategy-documents/new）。行クリック/操作列で編集・アーカイブ・削除。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, QueryState, RowMenuItem, ServerResult } from "@/components/ui";

import { archiveStrategyDoc, deleteStrategyDoc, fetchStrategyDocs, STRATEGY_CHANGED_EVENT } from "../api";
import { DOC_KIND_LABEL } from "../types";
import type { StrategyDocListItem } from "../types";
import "../strategy.css";

const KIND_VALUES = Object.keys(DOC_KIND_LABEL);
const fmtDate = (s: string | null) => (s ? s : "—");
const period = (r: StrategyDocListItem) => (r.period_from || r.period_to ? `${fmtDate(r.period_from)} 〜 ${fmtDate(r.period_to)}` : "—");

export function StrategyListView() {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const bump = () => setRefreshToken((n) => n + 1);
    window.addEventListener(STRATEGY_CHANGED_EVENT, bump);
    return () => window.removeEventListener(STRATEGY_CHANGED_EVENT, bump);
  }, []);

  const serverQuery = useCallback(
    async (state: QueryState, signal: AbortSignal): Promise<ServerResult<StrategyDocListItem>> => {
      const res = await fetchStrategyDocs(state, signal);
      if (!res) return { rows: [], total: 0, pinned: [] };
      return { rows: res.data, total: res.page_info.total, pinned: [] };
    },
    [refreshToken],
  );

  // 操作メニューの並び＝統一順（編集→複製→アーカイブ→削除・デザイン標準 §4.5 複製標準）。
  const menuItems = useCallback((r: StrategyDocListItem): RowMenuItem[] => {
    const list: RowMenuItem[] = [
      { label: "編集", onClick: () => router.push(`/strategy-documents/${r.id}/edit`) },
      // 複製＝登録ダイアログを「追加モード」で選択行の値をプリフィルして開く（別レコード新規作成・§複製標準）。
      { label: "複製", onClick: () => router.push(`/strategy-documents/new?from=${r.id}`) },
    ];
    if (r.status === "active") {
      list.push({
        label: "アーカイブ",
        onClick: async () => {
          const ok = await confirm({ title: "アーカイブ", msg: `「${r.title}」をアーカイブしますか？（クエストの選択候補から外れます）` });
          if (!ok) return;
          await archiveStrategyDoc(r.id).catch(() => null);
          snack({ type: "success", title: "アーカイブしました" });
          setRefreshToken((n) => n + 1);
        },
      });
    }
    list.push({
      label: "削除",
      danger: true,
      onClick: async () => {
        const ok = await confirm({ title: "経営資料を削除", msg: `「${r.title}」を削除しますか？（取り消せません）`, variant: "danger" });
        if (!ok) return;
        await deleteStrategyDoc(r.id).catch(() => null);
        snack({ type: "success", title: "削除しました" });
        setRefreshToken((n) => n + 1);
      },
    });
    return list;
  }, [router, confirm, snack]);

  const columns: DataTableColumn<StrategyDocListItem>[] = useMemo(() => [
    { key: "_actions", label: "", actions: true, locked: true, width: 60, render: (r) => <RowMenu items={menuItems(r)} /> },
    { key: "title", label: "タイトル", sortable: true, width: 320, sortVal: (r) => r.title },
    { key: "doc_kind", label: "種別", sortable: true, width: 140,
      filter: { type: "enum", options: KIND_VALUES.map((v) => [v, DOC_KIND_LABEL[v]] as [string, string]) },
      sortVal: (r) => r.doc_kind, render: (r) => DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind },
    { key: "status", label: "状態", sortable: true, width: 100,
      filter: { type: "enum", options: [["active", "有効"], ["archived", "アーカイブ"]] },
      sortVal: (r) => r.status, render: (r) => (r.status === "active" ? "有効" : "アーカイブ") },
    { key: "period", label: "対象期間", width: 220, render: period },
    { key: "period_from", label: "開始日", sortable: true, width: 120, hiddenDefault: true, sortVal: (r) => r.period_from ?? "" },
    { key: "updated_at", label: "更新日", sortable: true, width: 140, sortVal: (r) => r.updated_at, render: (r) => r.updated_at.slice(0, 10) },
  ], [menuItems]);

  return (
    <main className="container" style={{ paddingBlock: "var(--space-6) var(--space-16)" }}>
      <div className="strategy-list-head">
        <h1>経営資料</h1>
        <Link className="btn btn-primary" href="/strategy-documents/new">＋ 経営資料を登録</Link>
      </div>
      <p className="hint" style={{ maxWidth: 720 }}>
        中長期計画・方針・戦略などの会社の基準文書を登録します（会社アカウント管理者）。クエスト作成時にここから資料を選ぶと、配下アイデアの「方針との関連度」を算出します。
      </p>
      <DataTable<StrategyDocListItem>
        storageKey="strategy"
        server={{ query: serverQuery }}
        refreshToken={refreshToken}
        columns={columns}
        onRowClick={(r) => router.push(`/strategy-documents/${r.id}/edit`)}
        pins={false}
        emptyText="経営資料がまだありません。「＋ 経営資料を登録」から追加してください。"
        defaultView="card"
        cardRaw={(r) => (
          // ⋮ は Link の外（兄弟）に置く＝アンカー内 button の不正 HTML を避ける（ProjectCard §4.5 と同方式）。
          <div className="strategy-card" style={{ position: "relative" }}>
            <Link className="card card-accent" href={`/strategy-documents/${r.id}/edit`}>
              <div className="between">
                <span className="card-title">{r.title}</span>
                <span className="badge badge-muted">{r.status === "active" ? "有効" : "アーカイブ"}</span>
              </div>
              <div className="strategy-card__meta">
                <span>{DOC_KIND_LABEL[r.doc_kind] ?? r.doc_kind}</span>
                <span>{period(r)}</span>
                <span>更新 {r.updated_at.slice(0, 10)}</span>
              </div>
            </Link>
            <div style={{ position: "absolute", right: "var(--space-2)", bottom: "var(--space-2)" }}>
              <RowMenu items={menuItems(r)} />
            </div>
          </div>
        )}
      />
    </main>
  );
}
