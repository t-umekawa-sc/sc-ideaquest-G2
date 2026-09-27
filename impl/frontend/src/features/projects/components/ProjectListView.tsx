"use client";

// SC-70 プロジェクト一覧（FR-43・Q.1）＝go コンセプト由来のソリューション開発プロジェクト一覧。
// 一覧は共有 DataTable（他一覧と同じ標準 UI＝フロントエンド実装フロー規約 §2.1c 踏襲）。行クリックで SC-71 詳細へ。
// 正＝doc/画面設計/screens/SC-70_プロジェクト一覧.md。作成導線は持たない（SC-61「開発を始める」から）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar, DataTable, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createProject, deleteProject, getProject, listProjectMembers, listProjects, PROJECTS_CHANGED_EVENT } from "../api";
import type { ProjectListItem, ProjectStatus } from "../types";
import "../projects.css";

const STATUS_LABEL: Record<string, string> = { planning: "計画中", in_progress: "進行中", on_hold: "保留", done: "完了" };
const STATUS_CLS: Record<string, string> = { planning: "badge badge-muted", in_progress: "badge badge-success", on_hold: "badge badge-muted", done: "badge badge-muted" };
const STATUS_OPTIONS: [string, string][] = (Object.keys(STATUS_LABEL) as ProjectStatus[]).map((k) => [STATUS_LABEL[k], STATUS_LABEL[k]]);

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", "/") : "—";
}
export function ProjectListView() {
  const router = useRouter();
  const snack = useSnackbar();
  const confirm = useConfirm();
  const [rows, setRows] = useState<ProjectListItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => { void listProjects().then(setRows); };
  // 初回＋URL 付きモーダル（別ルート）での作成/編集/削除の跨ルート通知で再取得。
  useEffect(() => {
    reload();
    const on = () => reload();
    window.addEventListener(PROJECTS_CHANGED_EVENT, on);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, on);
  }, []);

  // 複製＝標準タスク管理として複製（コンセプト1:1制約を避けるため由来コンセプトは引き継がない）。詳細＋メンバーをコピー。
  async function duplicate(p: ProjectListItem) {
    if (busy) return;
    if (!(await confirm({ title: "プロジェクトを複製", msg: `「${p.title}」を複製します（コンセプト非依存の複製・開発メンバーは引き継ぎます）。よろしいですか？` }))) return;
    setBusy(true);
    try {
      const [detail, mem] = await Promise.all([getProject(p.id), listProjectMembers(p.id)]);
      const dep = (detail?.deployment ?? {}) as Record<string, string>;
      const members = mem.members.filter((m) => m.user).map((m) => ({ user_id: m.user!.user_id, role: m.role }));
      const created = await createProject({ title: `${p.title}（複製）`, description: detail?.description ?? null, deployment: dep, members });
      snack({ type: "success", title: "プロジェクトを複製しました" });
      reload();
      if (created) router.push(`/projects/${created.id}`);
    } catch {
      snack({ type: "error", title: "複製できませんでした", msg: "時間をおいて再試行してください。" });
    } finally { setBusy(false); }
  }

  async function remove(p: ProjectListItem) {
    if (busy) return;
    if (!(await confirm({ variant: "danger", title: "プロジェクトを削除", msg: `「${p.title}」を削除しますか？ 一覧から見えなくなります（タスク・チャット等は監査のため保持されます）。` }))) return;
    setBusy(true);
    try {
      await deleteProject(p.id);
      snack({ type: "success", title: "プロジェクトを削除しました" });
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) snack({ type: "error", title: "権限がありません", msg: "削除は起票者/owner のみです。" });
      else snack({ type: "error", title: "削除できませんでした", msg: "時間をおいて再試行してください。" });
    } finally { setBusy(false); }
  }

  // 操作メニューの並び＝統一順（詳細を開く→編集→複製→削除）。
  const rowMenu = (p: ProjectListItem): RowMenuItem[] => [
    { label: "詳細を開く", onClick: () => router.push(`/projects/${p.id}`) },
    { label: "編集", onClick: () => router.push(`/projects/${p.id}/edit`) },
    { label: "複製", onClick: () => void duplicate(p) },
    { label: "削除", danger: true, onClick: () => void remove(p) },
  ];

  const columns: DataTableColumn<ProjectListItem>[] = [
    {
      key: "title", label: "プロジェクト名", locked: true, width: 260, sortable: true, filter: { type: "text" },
      sortVal: (p) => p.title, searchVal: (p) => p.title, csvVal: (p) => p.title,
      // 件名はリンクにしない＝行クリックで遷移（他一覧＝クエスト/アイデアと統一）。リスト形式は溢れを「…」省略（cell-wrap を付けない＝DataTable 既定の ellipsis）。
      render: (p) => p.title,
    },
    { key: "concept", label: "由来コンセプト", width: 180, sortable: true, filter: { type: "text" }, sortVal: (p) => p.concept?.title ?? "", searchVal: (p) => p.concept?.title ?? "", csvVal: (p) => p.concept?.title ?? "", render: (p) => p.concept ? p.concept.title : <span className="muted">—</span> },
    { key: "quest", label: "由来クエスト", width: 160, sortable: true, filter: { type: "text" }, sortVal: (p) => p.quest?.title ?? "", searchVal: (p) => p.quest?.title ?? "", csvVal: (p) => p.quest?.title ?? "", render: (p) => <span>{p.quest?.title ?? "—"}</span> },
    { key: "status", label: "状態", width: 100, sortable: true, filter: { type: "enum", options: STATUS_OPTIONS }, sortVal: (p) => STATUS_LABEL[p.status], filterVal: (p) => STATUS_LABEL[p.status], render: (p) => <span className={STATUS_CLS[p.status]}>{STATUS_LABEL[p.status]}</span> },
    { key: "progress", label: "進捗", width: 90, align: "num", sortable: true, sortVal: (p) => (p.progress.total ? p.progress.done / p.progress.total : 0), csvVal: (p) => `${p.progress.done}/${p.progress.total}`, render: (p) => <span className="proj-progress__num">{p.progress.done}/{p.progress.total}</span> },
    { key: "tasks", label: "タスク", width: 110, align: "num", sortable: true, sortVal: (p) => p.task_count, render: (p) => p.task_count },
    { key: "owner", label: "所有者", width: 150, sortVal: (p) => p.owner?.display_name ?? "", csvVal: (p) => p.owner?.display_name ?? "", render: (p) => p.owner ? <span className="proj-owner"><Avatar name={p.owner.display_name} imageUrl={p.owner.avatar_image_url} size="sm" noTooltip />{p.owner.display_name}</span> : <span className="muted">—</span> },
    { key: "updated", label: "更新", width: 110, sortable: true, sortVal: (p) => p.updated_at, csvVal: (p) => fmtDate(p.updated_at), render: (p) => fmtDate(p.updated_at) },
    { key: "_actions", label: "", actions: true, locked: true, width: 56, render: (p) => <RowMenu items={rowMenu(p)} /> },
  ];

  return (
    <section aria-label="プロジェクト一覧">
      <Link className="backlink backlink--float" href="/">← ダッシュボードへ戻る</Link>
      <div className="page-head">
        <h1>プロジェクト一覧</h1>
        <Link href="/projects/new" className="btn btn-primary">＋ プロジェクトを作成</Link>
      </div>
      <p className="muted text-sm" style={{ marginBottom: "var(--space-4)" }}>
        ソリューション開発（ISO ④⑤）＝タスク管理。コンセプトから起票（詳細の「開発を始める」）／コンセプト無しの単純タスク管理は「＋ プロジェクトを作成」から。
      </p>

      {rows === null ? (
        <p className="muted">読み込み中…</p>
      ) : (
        <DataTable<ProjectListItem>
          storageKey="sc70-projects"
          data={rows}
          columns={columns}
          rowId={(p) => p.id}
          unit="件"
          perPage={12}
          perPageOptions={[12, 24, 48]}
          searchFields="プロジェクト名・コンセプト・クエスト"
          exportName="プロジェクト一覧"
          emptyText="まだプロジェクトがありません。「＋ プロジェクトを作成」か、コンセプト詳細の『開発を始める』で起票します。"
          onRowClick={(p) => router.push(`/projects/${p.id}`)}
          pins={false}
          defaultView="card"
          cardRaw={(p) => (
            // ⋯ は Link の外（兄弟・右上）に置く＝アンカー内 button の不正 HTML を避ける（クエストカード §4.5 と同方式）。
            <div className="proj-card-wrap" style={{ position: "relative" }}>
              {/* 見出し・meta を折り返させない＝クエストカードと同方式（cardRaw で完全制御・DataTable の stats 自動レイアウトは使わない）。 */}
              <Link className="card card-accent proj-card" href={`/projects/${p.id}`}>
                <div className="between">
                  <span className="card-title proj-card__title">{p.title}</span>
                  <span className={STATUS_CLS[p.status]}>{STATUS_LABEL[p.status]}</span>
                </div>
                <div className="proj-card__origin-row">
                  <span className="badge badge-muted proj-card__origin">{p.concept ? `由来: ${p.concept.title}` : "コンセプト無し"}</span>
                </div>
                <div className="proj-card__meta proj-card__meta--stats">
                  <span>進捗 {p.progress.done}/{p.progress.total}</span>
                  <span>タスク {p.task_count}</span>
                  <span>更新 {fmtDate(p.updated_at)}</span>
                </div>
              </Link>
              {/* ⋯ は右下（stats は左寄せで右下が空く）＝ステータスバッジと衝突しない。RowMenu は stopPropagation でカード遷移を抑止。 */}
              <div className="proj-card__menu" style={{ position: "absolute", right: "var(--space-2)", bottom: "var(--space-2)" }}>
                <RowMenu items={rowMenu(p)} />
              </div>
            </div>
          )}
        />
      )}
    </section>
  );
}
