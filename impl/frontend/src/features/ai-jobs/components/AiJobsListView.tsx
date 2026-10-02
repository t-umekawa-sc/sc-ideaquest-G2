"use client";

// SC-04 AI処理状況（ドメイン S・FR-45）。自分の AIジョブ（LLM 要約/生成）の待ち/実行中/完了・失敗を1画面で。
// サーバー委譲（GET /ai-jobs・DataTable §1.8.1）＋状態サマリ（GET /ai-jobs/summary）。実行中はキャンセル可、
// 完了は対象画面へ遷移（ref_*）。踏襲＝SC-02 通知＋共有 DataTable（新規UIを作らない）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable, Progress, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, QueryState, RowMenuItem, ServerResult } from "@/components/ui";

import { AI_JOBS_CHANGED_EVENT, cancelAiJob, fetchAiJobs, fetchAiJobsSummary, fetchRunningProgress } from "../api";
import { STATUS_BADGE, STATUS_LABEL, TASK_LABEL } from "../types";
import type { AiJobListItem, AiJobStatus, AiJobSummary, RunningJobItem } from "../types";
import "../ai-jobs.css";

const taskLabel = (t: string) => TASK_LABEL[t] ?? t;
const statusBadge = (s: AiJobStatus) => <span className={`badge ${STATUS_BADGE[s]}`}>{STATUS_LABEL[s]}</span>;

// 進捗・待ち列＝実行中は進捗率、待機は「前に N 件待機」（会社全体キュー基準＝queue_position−1）、その他は —。
// ※見込み時間（ETA）は処理内容で大きく変動し誤認を招くため表示しない（SC-04 §3・決定 2026-10-02）。
function progressText(r: AiJobListItem): string {
  if (r.status === "queued") {
    if (r.queue_position == null) return "待ち";
    const ahead = Math.max(0, r.queue_position - 1); // 自分より前に待っている件数
    return ahead === 0 ? "次に実行" : `前に ${ahead} 件待機`;
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
  const [others, setOthers] = useState<RunningJobItem[]>([]); // 他ユーザの実行中（進捗率のみ・匿名）

  const reload = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener(AI_JOBS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(AI_JOBS_CHANGED_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    const ac = new AbortController();
    fetchAiJobsSummary(ac.signal).then((s) => s && setSummary(s)).catch(() => {});
    fetchRunningProgress(ac.signal).then(setOthers).catch(() => {});
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
    const detail: RowMenuItem = { label: "詳細を開く", onClick: () => router.push(`/ai-jobs/${r.id}`) };
    // 処理済み（succeeded）かつ関連画面（ref_*）あり＝「結果を見る」が主要アクション→メニュー先頭（§4.5）。
    const href = r.status === "succeeded" ? targetHref(r) : null;
    const list: RowMenuItem[] = href
      ? [{ label: "結果を見る", onClick: () => router.push(href) }, detail]
      : [detail];
    if (r.status === "queued" || r.status === "running") {
      list.push({
        label: "キャンセル",
        danger: true, // 否定的/注意アクション＝赤（.is-danger）。RowMenu は中立/赤の2状態（黄色は非対応）＝削除系と統一・§4.5。
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
      {/* 画面上部のフローティング戻るピル（§4.10）。DataTable の floatHead がこのピル高を検知して列見出しを下に固定＝重ならない。 */}
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
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
      {others.length > 0 && (
        <section className="ai-others" aria-label="他の実行中のAI処理">
          <h2 className="ai-others__title">他の実行中のAI処理（{others.length}）</h2>
          <div className="ai-others__list">
            {others.map((o, i) => (
              <Progress key={i} value={o.ratio != null ? o.ratio * 100 : undefined} label={`実行中 #${i + 1}`} variant="xp" />
            ))}
          </div>
          <p className="hint">あなたの依頼より先に処理されている他ユーザの実行中です（内容は非表示）。これが進むほど、あなたの順番が近づきます。</p>
        </section>
      )}
      <DataTable<AiJobListItem>
        storageKey="ai-jobs"
        server={{ query: serverQuery }}
        refreshToken={refreshToken}
        columns={columns}
        onRowClick={(r) => {
          // 処理済み（succeeded）＋関連画面あり＝関連画面へ（「結果を見る」と同じ）。それ以外＝詳細モーダル。
          const h = r.status === "succeeded" ? targetHref(r) : null;
          router.push(h ?? `/ai-jobs/${r.id}`);
        }}
        pins={false}
        emptyText="現在 AI 処理はありません。"
        defaultView="list"
      />
    </main>
  );
}
