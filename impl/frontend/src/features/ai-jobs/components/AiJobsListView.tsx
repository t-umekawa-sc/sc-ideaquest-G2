"use client";

// SC-04 AI処理状況（ドメイン S・FR-45）。自分の AIジョブ（LLM 要約/生成）の待ち/実行中/完了・失敗を1画面で。
// サーバー委譲（GET /ai-jobs・DataTable §1.8.1）＋状態サマリ（GET /ai-jobs/summary）。実行中はキャンセル可、
// 完了は対象画面へ遷移（ref_*）。踏襲＝SC-02 通知＋共有 DataTable（新規UIを作らない）。
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, QueryState, RowMenuItem, ServerResult } from "@/components/ui";

import { AI_JOBS_CHANGED_EVENT, cancelAiJob, fetchAiJobs, fetchAiJobsSummary } from "../api";
import { STATUS_BADGE, STATUS_LABEL, TASK_LABEL } from "../types";
import type { AiJobListItem, AiJobStatus, AiJobSummary } from "../types";
import "../ai-jobs.css";

const taskLabel = (t: string) => TASK_LABEL[t] ?? t;
const statusBadge = (s: AiJobStatus) => <span className={`badge ${STATUS_BADGE[s]}`}>{STATUS_LABEL[s]}</span>;

// 概算 ETA を「約N分後 / 約N時間M分後」に整形（0=まもなく）。
function fmtEta(sec: number): string {
  if (sec <= 0) return "まもなく";
  if (sec < 3600) return `約${Math.max(1, Math.ceil(sec / 60))}分後`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `約${h}時間${m}分後` : `約${h}時間後`;
}

// 進捗列＝実行中は %、待ちは「N番目（・約M分後）」、その他は —。
function progressText(r: AiJobListItem): string {
  if (r.status === "queued") {
    if (r.queue_position == null) return "待ち";
    const pos = `${r.queue_position}番目`;
    return r.eta_seconds == null ? pos : `${pos}・${fmtEta(r.eta_seconds)}`;
  }
  if (r.status !== "running") return "—";
  const p = r.progress;
  if (!p) return "実行中…";
  if (typeof p.ratio === "number") return `${Math.round(p.ratio * 100)}%${p.phase ? `（${p.phase}）` : ""}`;
  return p.phase ? `（${p.phase}）` : "実行中…";
}

// 完了ジョブの遷移先（ref_* → 対象画面）。無ければ null（遷移しない）。
function targetHref(r: AiJobListItem): string | null {
  if (r.ref_idea_id) return `/ideas/${r.ref_idea_id}`;
  if (r.ref_strategy_document_id) return `/strategy-documents/${r.ref_strategy_document_id}/edit`;
  if (r.ref_info_item_id) return `/info-items/${r.ref_info_item_id}`;
  if (r.ref_quest_id) return `/quests/${r.ref_quest_id}`;
  return null;
}

export function AiJobsListView() {
  const router = useRouter();
  const confirm = useConfirm();
  const snack = useSnackbar();
  const [refreshToken, setRefreshToken] = useState(0);
  const [summary, setSummary] = useState<AiJobSummary | null>(null);

  const reload = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(AI_JOBS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AI_JOBS_CHANGED_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    const ac = new AbortController();
    fetchAiJobsSummary(ac.signal).then((s) => s && setSummary(s)).catch(() => {});
    return () => ac.abort();
  }, [refreshToken]);

  const serverQuery = useCallback(
    async (state: QueryState, signal: AbortSignal): Promise<ServerResult<AiJobListItem>> => {
      const res = await fetchAiJobs(state, signal);
      if (!res) return { rows: [], total: 0, pinned: [] };
      return { rows: res.data, total: res.page_info.total, pinned: [] };
    },
    [refreshToken],
  );

  // メニュー順＝標準（デザイン標準§4.5＝主要/参照 → … → 破壊的は最後）＝詳細を開く → 内容を参照する → キャンセル。
  const menuItems = useCallback((r: AiJobListItem): RowMenuItem[] => {
    const list: RowMenuItem[] = [
      { label: "詳細を開く", onClick: () => router.push(`/ai-jobs/${r.id}`) },
    ];
    const href = targetHref(r);
    if (r.status === "succeeded" && href) {
      list.push({ label: "内容を参照する", onClick: () => router.push(href) });
    }
    if (r.status === "queued" || r.status === "running") {
      list.push({
        label: "キャンセル",
        onClick: async () => {
          const ok = await confirm({ title: "キャンセル", msg: "このAI処理をキャンセルしますか？" });
          if (!ok) return;
          await cancelAiJob(r.id).catch(() => null);
          snack({ type: "success", title: "キャンセルしました" });
          reload();
        },
      });
    }
    return list;
  }, [router, confirm, snack, reload]);

  const columns: DataTableColumn<AiJobListItem>[] = useMemo(() => [
    { key: "_actions", label: "", actions: true, locked: true, width: 60, render: (r) => <RowMenu items={menuItems(r)} /> },
    { key: "task_type", label: "種別", sortable: false, width: 200,
      filter: { type: "enum", options: Object.keys(TASK_LABEL).map((v) => [v, TASK_LABEL[v]] as [string, string]) },
      render: (r) => taskLabel(r.task_type) },
    { key: "status", label: "状態", sortable: false, width: 110,
      filter: { type: "enum", options: (Object.keys(STATUS_LABEL) as AiJobStatus[]).map((v) => [v, STATUS_LABEL[v]] as [string, string]) },
      render: (r) => statusBadge(r.status) },
    { key: "progress", label: "進捗・待ち", width: 170, render: progressText },
    { key: "created_at", label: "依頼", sortable: true, width: 160, sortVal: (r) => r.created_at, render: (r) => r.created_at.slice(0, 16).replace("T", " ") },
    { key: "finished_at", label: "完了", sortable: true, width: 160, sortVal: (r) => r.finished_at ?? "", render: (r) => (r.finished_at ? r.finished_at.slice(0, 16).replace("T", " ") : "—") },
  ], [menuItems]);

  return (
    <main className="container" style={{ paddingBlock: "var(--space-6) var(--space-16)" }}>
      <div className="ai-jobs-head">
        <h1>AI処理状況</h1>
        {summary && (
          <div className="ai-jobs-summary">
            <span className="badge badge-muted">待ち {summary.queued}</span>
            <span className="badge badge-info">実行中 {summary.running}</span>
            <span className="badge badge-success">直近完了 {summary.recent_done}</span>
            {summary.recent_failed > 0 && <span className="badge badge-danger">失敗 {summary.recent_failed}</span>}
          </div>
        )}
      </div>
      <p className="hint" style={{ maxWidth: 720 }}>
        あなたが依頼した AI 処理（要約・生成など）の状況です。実行中はキャンセルでき、完了したら操作メニューから対象画面を参照できます。
      </p>
      <DataTable<AiJobListItem>
        storageKey="ai-jobs"
        server={{ query: serverQuery }}
        refreshToken={refreshToken}
        columns={columns}
        onRowClick={(r) => router.push(`/ai-jobs/${r.id}`)}
        pins={false}
        emptyText="現在 AI 処理はありません。"
        defaultView="list"
      />
    </main>
  );
}
