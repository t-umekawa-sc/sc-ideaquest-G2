"use client";

// SC-71 プロジェクト詳細（FR-43・Q.1/Q.2/Q.4）＝WBSツリー＋開発メンバー（SC-12 party 一覧踏襲）＋導入・価値実現メタ
// ＋タスクチャット（両担当同席＝仕様ブレ突き合わせ・接続時は共有 IdeaChatView〔taskSource〕へ）。
// 正＝doc/画面設計/screens/SC-71_プロジェクト詳細.md。新規UIは作らず既存クラス/部品を踏襲（§2.1c）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Avatar, DataTable, LoadingOverlay, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { timeLabel } from "@/features/notifications/time";
import { createTask, deleteTask, getProject, listProjectMembers, listProjectTasks, listRecentTaskChats, patchTask } from "../api";
import type { RecentTaskChat } from "../api";
import type { DeploymentMeta, ProjectDetail, ProjectMember, TaskNode, TaskStatus, UserRef } from "../types";
import "@/features/dashboard/dashboard.css"; // 🕒最近の議論の一覧クラス（.unread-list/.unread-item）をダッシュボードから踏襲（§2.1c）
import { TaskForm, type TaskSavePayload } from "./TaskForm";
import { ProjectForm } from "./ProjectForm";
import { ProjectMembersModal } from "./ProjectMembersModal";
import "@/features/quests/quests.css"; // パーティー一覧の共有クラス（.member-list/.member-row/.member-name/.member-perms/.tab-party-card）を踏襲（§2.1c）
import "../projects.css";

const P_STATUS_LABEL: Record<string, string> = { planning: "計画中", in_progress: "進行中", on_hold: "保留", done: "完了" };
const P_STATUS_CLS: Record<string, string> = { planning: "badge badge-muted", in_progress: "badge badge-success", on_hold: "badge badge-muted", done: "badge badge-muted" };
const T_STATUS_LABEL: Record<string, string> = { todo: "未着手", doing: "進行中", done: "完了", blocked: "ブロック" };
const T_STATUS_CLS: Record<string, string> = { todo: "badge badge-muted", doing: "badge badge-success", done: "badge badge-muted", blocked: "badge badge-danger" };
const KIND_LABEL: Record<string, string> = { requirement: "要件", task: "作業" };
type WbsFilter = "all" | "doing" | "done" | "blocked" | "mine";

// 子孫（自分含まず葉基準）の done 比率＝進捗ロールアップ（均等重み・MVP）。
function rollup(node: TaskNode): { done: number; total: number } {
  if (!node.children?.length) return { done: node.status === "done" ? 1 : 0, total: 1 };
  return node.children.reduce((acc, c) => { const r = rollup(c); return { done: acc.done + r.done, total: acc.total + r.total }; }, { done: 0, total: 0 });
}

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const snack = useSnackbar();
  const confirm = useConfirm();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<TaskNode[] | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [innovation, setInnovation] = useState<UserRef[]>([]);
  const [recentChats, setRecentChats] = useState<RecentTaskChat[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"wbs" | "members" | "deploy">("wbs");
  const [wbsFilter, setWbsFilter] = useState<WbsFilter>("all");
  const [taskForm, setTaskForm] = useState<{ task?: TaskNode | null; parentId?: string | null; dup?: TaskNode | null } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const reloadAll = useCallback(async () => {
    const [p, t, m, rc] = await Promise.all([getProject(projectId), listProjectTasks(projectId), listProjectMembers(projectId), listRecentTaskChats(projectId)]);
    setProject(p); setTasks(t); setMembers(m.members); setInnovation(m.innovation); setRecentChats(rc);
  }, [projectId]);
  const reloadTasks = useCallback(async () => {
    const [t, rc] = await Promise.all([listProjectTasks(projectId), listRecentTaskChats(projectId)]);
    setTasks(t); setRecentChats(rc);
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    void reloadAll().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadAll]);

  const canManage = project?.my_permissions.can_manage_tasks ?? false;

  async function quickStatus(node: TaskNode, next: TaskStatus) {
    try {
      await patchTask(node.id, { status: next });
      const becameDone = next === "done" && node.status !== "done";
      snack({ type: "success", title: "状態を更新しました", msg: becameDone ? "完了により開発XP＋コインを獲得しました。" : undefined });
      await reloadTasks();
    } catch { snack({ type: "error", title: "更新できませんでした", msg: "権限をご確認ください。" }); }
  }

  // 作成/編集を実 API へ（子タスクの子…と任意深さで入れ子可）。
  async function applyTaskSave(p: TaskSavePayload) {
    try {
      if (p.id) {
        await patchTask(p.id, { kind: p.kind, title: p.title, description: p.description || null, assignee_account_id: p.assigneeId || null, status: p.status, due_date: p.dueDate || null, parent_task_id: p.parentId });
      } else {
        await createTask(projectId, { parent_task_id: p.parentId, kind: p.kind, title: p.title, description: p.description || null, assignee_account_id: p.assigneeId || null, status: p.status, due_date: p.dueDate || null, sort_order: 999 });
      }
      await reloadTasks();
    } catch { snack({ type: "error", title: "保存できませんでした", msg: "入力・権限をご確認ください。" }); }
  }

  async function delTask(node: TaskNode) {
    const ok = await confirm({ variant: "danger", title: "タスクを削除", msg: `「${node.title}」を削除しますか？` });
    if (!ok) return;
    try {
      await deleteTask(node.id);
      snack({ type: "success", title: "タスクを削除しました" });
      await reloadTasks();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) snack({ type: "error", title: "子タスクがあります", msg: "先に子タスクを処理してください。" });
      else snack({ type: "error", title: "削除できませんでした" });
    }
  }

  // ツリーを深さ付きで平坦化＝標準 DataTable の行に載せる（順序はツリー順・インデントで階層を表現）。
  const flatTasks: FlatTask[] = tasks ? flattenTasks(tasks) : [];
  // クイックフィルタ（アイデア一覧と同型）＝すべて/進行中/完了/ブロック/自分のタスク。
  // 自分のタスク＝担当が自分 かつ 完了/ブロック以外（＝これから動くべき自分の仕事）。
  const meId = project?.viewer_user_id;
  const isMine = (t: FlatTask) => !!meId && t.assignee?.user_id === meId && (t.status === "todo" || t.status === "doing");
  const wbsCounts: Record<WbsFilter, number> = {
    all: flatTasks.length,
    doing: flatTasks.filter((t) => t.status === "doing").length,
    done: flatTasks.filter((t) => t.status === "done").length,
    blocked: flatTasks.filter((t) => t.status === "blocked").length,
    mine: flatTasks.filter(isMine).length,
  };
  const filteredTasks = flatTasks.filter((t) => {
    switch (wbsFilter) {
      case "doing": return t.status === "doing";
      case "done": return t.status === "done";
      case "blocked": return t.status === "blocked";
      case "mine": return isMine(t);
      default: return true;
    }
  });
  const wbsMenu = (t: FlatTask): RowMenuItem[] => [
    { label: "💬 チャット", onClick: () => router.push(`/projects/${projectId}/tasks/${t.id}/chat`) },
    t.status !== "done"
      ? { label: "完了にする", onClick: () => void quickStatus(t, "done") }
      : { label: "未完了に戻す", onClick: () => void quickStatus(t, "todo") },
    { label: "子タスクを追加", onClick: () => setTaskForm({ task: null, parentId: t.id }) },
    { label: "編集", onClick: () => setTaskForm({ task: t }) },
    { label: "複製", onClick: () => setTaskForm({ task: null, parentId: t.parent_task_id, dup: t }) },
    { label: "削除", danger: true, onClick: () => void delTask(t) },
  ];
  const wbsColumns: DataTableColumn<FlatTask>[] = [
    { key: "kind", label: "粒度", width: 90, sortable: true, filter: { type: "enum", options: [["要件", "要件"], ["作業", "作業"]] }, sortVal: (t) => KIND_LABEL[t.kind] ?? t.kind, filterVal: (t) => KIND_LABEL[t.kind] ?? t.kind, render: (t) => <span className="badge badge-muted">{KIND_LABEL[t.kind] ?? t.kind}</span> },
    { key: "title", label: "タスク名", locked: true, width: 320, searchVal: (t) => t.title, csvVal: (t) => t.title, render: (t) => <span style={{ paddingLeft: `${t.depth * 20}px` }} className={t.status === "done" ? "muted" : undefined}>{t.title}</span> },
    { key: "status", label: "状態", width: 110, sortable: true, filter: { type: "enum", options: (Object.keys(T_STATUS_LABEL) as TaskStatus[]).map((s) => [T_STATUS_LABEL[s], T_STATUS_LABEL[s]]) }, sortVal: (t) => T_STATUS_LABEL[t.status], filterVal: (t) => T_STATUS_LABEL[t.status], render: (t) => <span className={T_STATUS_CLS[t.status]}>{T_STATUS_LABEL[t.status]}</span> },
    { key: "assignee", label: "担当", width: 170, sortable: true, sortVal: (t) => t.assignee?.display_name ?? "", csvVal: (t) => t.assignee?.display_name ?? "", render: (t) => t.assignee ? <span className="proj-owner"><Avatar name={t.assignee.display_name} imageUrl={t.assignee.avatar_image_url} size="sm" noTooltip />{t.assignee.display_name}</span> : <span className="muted">未割当</span> },
    { key: "progress", label: "進捗", width: 90, align: "num", csvVal: (t) => { const r = t.children?.length ? rollup(t) : null; return r ? `${r.done}/${r.total}` : ""; }, render: (t) => { const r = t.children?.length ? rollup(t) : null; return r ? <span className="muted">{r.done}/{r.total}</span> : <span className="muted">—</span>; } },
    { key: "due", label: "期日", width: 120, sortable: true, sortVal: (t) => t.due_date ?? "", csvVal: (t) => t.due_date ?? "", render: (t) => t.due_date ? t.due_date.replaceAll("-", "/") : <span className="muted">—</span> },
    ...(canManage ? [{ key: "_actions", label: "", actions: true, locked: true, width: 56, render: (t: FlatTask) => <RowMenu items={wbsMenu(t)} /> } as DataTableColumn<FlatTask>] : []),
  ];

  if (loading) return <LoadingOverlay label="読み込み中…" />;
  if (!project) return <div className="empty-page">プロジェクトが見つかりません。</div>;

  const TABS: { key: "wbs" | "members" | "deploy"; label: string; count?: number }[] = [
    { key: "wbs", label: "🧩 WBS", count: project.progress.total },
    { key: "members", label: "👥 開発メンバー", count: members.length },
    { key: "deploy", label: "🚀 導入・価値実現" },
  ];

  return (
    <section aria-label="プロジェクト詳細" className="proj-detail">
      <Link className="backlink backlink--float" href="/projects">← プロジェクト一覧へ戻る</Link>

      {/* ヘッダー＋最近の議論を2段組（クエスト詳細の quest-head-row を踏襲＝概要パネルの右に議論・§2.1c）。 */}
      <div className="quest-head-row">
      <section className="card quest-head proj-head" aria-label="プロジェクト情報">
        <div className="proj-head__top">
          {/* クエスト詳細と同じ既定フォント（.quest-head h1）＝page-title の pixel フォントは使わない（ユーザー要望）。 */}
          <h1 style={{ margin: 0 }}>{project.title}</h1>
          <span className={P_STATUS_CLS[project.status]}>{P_STATUS_LABEL[project.status]}</span>
          {project.my_permissions.can_edit && <button type="button" className="btn btn-outline" style={{ marginLeft: "auto" }} onClick={() => setEditOpen(true)}>編集</button>}
        </div>
        {project.description && <p className="muted" style={{ marginTop: 6 }}>{project.description}</p>}
        <div className="proj-head__meta">
          {project.concept ? <span>由来コンセプト: <Link href={`/concepts/${project.concept.id}`}>{project.concept.title}</Link></span> : <span className="muted">コンセプト非依存（単純タスク管理）</span>}
          {project.quest && <span>由来クエスト: <Link href={`/quests/${project.quest.id}`}>{project.quest.title}</Link></span>}
          <span>所有者: {project.owner?.display_name ?? "—"}</span>
          <span>進捗: {project.progress.done}/{project.progress.total}</span>
        </div>
      </section>

      {/* 🕒 最近の議論＝このプロジェクト内タスクのチャットのみ（更新順・既読/未読問わず・概要パネルの右・FR-43・SC-71）。 */}
      <section className="card quest-activity" aria-label="最近の議論">
        <div className="section-head">
          <h2 style={{ fontSize: "var(--text-lg)" }}>🕒 最近の議論</h2>
          <span className="muted text-xs">タスクチャット・更新順</span>
        </div>
        {recentChats.length > 0 ? (
          <ul className="unread-list">
            {recentChats.map((c) => (
              <li key={c.task_id}>
                <Link className="unread-item" href={`/projects/${projectId}/tasks/${c.task_id}/chat`}>
                  <span className="unread-item__title">💬 {c.title}</span>
                  {c.unread_chat_count > 0
                    ? <span className="badge badge-danger">💬 +{c.unread_chat_count}</span>
                    : <span className="notif-time muted">{c.last_chat_at ? timeLabel(c.last_chat_at) : ""}</span>}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted text-sm" style={{ margin: "var(--space-2) 0 0" }}>まだタスクのチャットはありません。WBS の各タスクの「💬 チャット」から議論を始めると、ここに更新順で並びます。</p>
        )}
      </section>
      </div>{/* .quest-head-row */}

      {/* タブ（クエスト詳細と同型＝.tabs role=tablist） */}
      <div className="tabs" role="tablist" aria-label="プロジェクト詳細のセクション">
        {TABS.map((t) => (
          <button key={t.key} className={`tab${tab === t.key ? " is-active" : ""}`} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}{t.count != null && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* WBS タブ＝標準 DataTable（ツリーを深さインデントで平坦化・行=タスク・⋯ 操作列・§2.1c／§4.5）＋アイデア一覧同型のクイックフィルタ */}
      {tab === "wbs" && (
        <section aria-label="WBS">
          <div className="ideas-tab-toolbar">
            <div className="segmented idea-filter" role="radiogroup" aria-label="タスクの絞り込み">
              {([["all", "すべて"], ["doing", "進行中"], ["done", "完了"], ["blocked", "ブロック"], ["mine", "自分のタスク"]] as const).map(([k, label]) => (
                <label key={k}>
                  <input type="radio" name="wbs-filter" checked={wbsFilter === k} onChange={() => setWbsFilter(k)} />
                  {label} <span className="idea-filter__n">{wbsCounts[k]}</span>
                </label>
              ))}
            </div>
            {canManage && <button type="button" className="btn btn-primary" onClick={() => setTaskForm({ task: null, parentId: null })}>＋ タスク追加</button>}
          </div>
          <DataTable<FlatTask>
            storageKey="sc71-wbs"
            data={filteredTasks}
            columns={wbsColumns}
            rowId={(t) => t.id}
            unit="件"
            perPage={50}
            perPageOptions={[20, 50, 100]}
            searchFields="タスク名"
            exportName="WBS"
            emptyText="まだタスクがありません。「＋ タスク追加」から作成できます。"
            onRowClick={(t) => setTaskForm({ task: t })}
            pins={false}
            defaultView="list"
            cardLayout={(t) => ({
              title: `${"　".repeat(t.depth)}${t.title}`,
              badges: [
                { label: KIND_LABEL[t.kind] ?? t.kind, cls: "badge badge-muted" },
                { label: T_STATUS_LABEL[t.status], cls: T_STATUS_CLS[t.status] },
              ],
              stats: [
                t.assignee ? `担当 ${t.assignee.display_name}` : "未割当",
                ...(t.children?.length ? [`進捗 ${rollup(t).done}/${rollup(t).total}`] : []),
                ...(t.due_date ? [`期日 ${t.due_date.replaceAll("-", "/")}`] : []),
              ],
            })}
          />
        </section>
      )}

      {/* 開発メンバー タブ＝クエストのパーティー行レイアウト（.card＞.member-list＞.member-row）を踏襲しつつ、開発担当とイノベーション担当を個別グループで表示（§2.1c） */}
      {tab === "members" && (
        <section aria-label="開発メンバー">
          <div className="list-toolbar">
            <div className="muted text-sm">開発メンバーとイノベーション担当（所有者/管理権限者が編集可）</div>
            {project.my_permissions.can_manage_members && <button type="button" className="btn btn-outline btn-sm" onClick={() => setMembersOpen(true)}>開発メンバーを管理</button>}
          </div>

          <h3 className="proj-members-group">開発メンバー</h3>
          <div className="card tab-party-card" style={{ padding: 0 }}>
            <ul className="member-list">
              {members.length === 0 ? (
                <li className="member-row"><span className="hint">開発メンバー未設定。「開発メンバーを管理」から追加します（担当割当には開発メンバーが必要）。</span></li>
              ) : members.filter((m) => m.user).map((m) => (
                <li className="member-row" key={m.user!.user_id}>
                  <Avatar name={m.user!.display_name} imageUrl={m.user!.avatar_image_url ?? undefined} />
                  <span className="member-name">{m.user!.display_name}</span>
                  <span className="member-perms">
                    <span className={`badge ${m.role === "lead" ? "" : "badge-muted"}`}>{m.role === "lead" ? "🛠 開発リード" : "開発担当"}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <h3 className="proj-members-group">イノベーション担当</h3>
          <div className="card tab-party-card" style={{ padding: 0 }}>
            <ul className="member-list">
              {innovation.length === 0 ? (
                <li className="member-row"><span className="hint">イノベーション担当はいません（コンセプト非依存プロジェクト）。</span></li>
              ) : innovation.map((u) => (
                <li className="member-row" key={u.user_id}>
                  <Avatar name={u.display_name} imageUrl={u.avatar_image_url ?? undefined} />
                  <span className="member-name">{u.display_name}</span>
                  <span className="member-perms"><span className="badge badge-muted">イノベーション担当</span></span>
                </li>
              ))}
            </ul>
          </div>

          <p className="hint" style={{ marginTop: "var(--space-3)" }}>※ 開発担当＝タスク担当・状態更新の主体（会社内の任意ユーザー）。イノベーション担当（由来クエストのパーティー）は参照＋チャット発言（口出し）が可能。</p>
        </section>
      )}

      {/* 導入・価値実現 タブ（⑤導入） */}
      {tab === "deploy" && (
        <section className="card proj-section" aria-label="導入・価値実現">
          <div className="proj-section__head">
            <h2 style={{ margin: 0 }}>導入・価値実現</h2>
            {project.my_permissions.can_edit && <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditOpen(true)}>編集</button>}
          </div>
          {(() => { const dep = (project.deployment ?? {}) as DeploymentMeta; return (
          <dl className="proj-deploy">
            <div><dt>ローンチ状態</dt><dd>{dep.launch_status || "—"}</dd></div>
            <div><dt>導入計画</dt><dd>{dep.plan || "—"}</dd></div>
            <div><dt>KPI 実測</dt><dd>{dep.kpi || "—"}</dd></div>
          </dl>); })()}
          <p className="hint">{project.concept ? "コンセプト段の viability（コスト/収益/ROI）を導入後の実測で検証し、次サイクルへ（ISO §9/§10）。" : "単純タスク管理でも、導入計画・KPI をメモできます。"}</p>
        </section>
      )}

      {taskForm && tasks && <TaskForm tasks={tasks} members={members} task={taskForm.task} dupFrom={taskForm.dup} defaultParentId={taskForm.parentId} onClose={() => setTaskForm(null)} onSaved={applyTaskSave} />}
      {membersOpen && <ProjectMembersModal projectId={projectId} members={members} innovation={innovation} ownerName={project.owner?.display_name ?? ""} onClose={() => setMembersOpen(false)} onSaved={() => void reloadAll()} />}
      {editOpen && <ProjectForm project={project} ownerName={project.owner?.display_name ?? ""} onClose={() => setEditOpen(false)} onUpdated={() => void reloadAll()} />}
    </section>
  );
}

// ツリーを深さ付きで平坦化（DataTable の行に載せる・順序はツリー順）。
export type FlatTask = TaskNode & { depth: number };
function flattenTasks(nodes: TaskNode[], depth = 0, out: FlatTask[] = []): FlatTask[] {
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children?.length) flattenTasks(n.children, depth + 1, out);
  }
  return out;
}
