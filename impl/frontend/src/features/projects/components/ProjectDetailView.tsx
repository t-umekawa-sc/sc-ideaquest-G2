"use client";

// SC-71 プロジェクト詳細（FR-43・Q.1/Q.2/Q.4）＝WBSツリー＋開発メンバー（SC-12 party 一覧踏襲）＋導入・価値実現メタ
// ＋タスクチャット（両担当同席＝仕様ブレ突き合わせ・接続時は共有 IdeaChatView〔taskSource〕へ）。
// 正＝doc/画面設計/screens/SC-71_プロジェクト詳細.md。新規UIは作らず既存クラス/部品を踏襲（§2.1c）。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar, DataTable, LoadingOverlay, RowMenu, useConfirm, useSnackbar } from "@/components/ui";
import type { DataTableColumn, RowMenuItem } from "@/components/ui";

import { getProject, listProjectMembers, listProjectTasks } from "../api";
import type { ProjectDetail, ProjectMember, ProjectStatus, TaskNode, TaskStatus, UserRef } from "../types";
import { TaskForm, type TaskSavePayload } from "./TaskForm";
import { ProjectMembersModal } from "./ProjectMembersModal";
import "@/features/quests/quests.css"; // パーティー一覧の共有クラス（.member-list/.member-row/.member-name/.member-perms/.tab-party-card）を踏襲（§2.1c）
import "../projects.css";

const P_STATUS_LABEL: Record<ProjectStatus, string> = { planning: "計画中", in_progress: "進行中", on_hold: "保留", done: "完了" };
const P_STATUS_CLS: Record<ProjectStatus, string> = { planning: "badge badge-muted", in_progress: "badge badge-success", on_hold: "badge badge-muted", done: "badge badge-muted" };
const T_STATUS_LABEL: Record<TaskStatus, string> = { todo: "未着手", doing: "進行中", done: "完了", blocked: "ブロック" };
const T_STATUS_CLS: Record<TaskStatus, string> = { todo: "badge badge-muted", doing: "badge badge-success", done: "badge badge-muted", blocked: "badge badge-danger" };
const KIND_LABEL: Record<string, string> = { requirement: "要件", task: "作業" };
// 現在ユーザー（試作＝接続時は GET /me）。「自分のタスク」フィルタ用。デモは佐藤（開発）にして動作を見せる。
const DEMO_ME_ID = "u-dev2";
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
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"wbs" | "members" | "deploy">("wbs");
  const [wbsFilter, setWbsFilter] = useState<WbsFilter>("all");
  const [taskForm, setTaskForm] = useState<{ task?: TaskNode | null; parentId?: string | null; dup?: TaskNode | null } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([getProject(projectId), listProjectTasks(projectId), listProjectMembers(projectId)]).then(([p, t, m]) => {
      if (!alive) return;
      setProject(p); setTasks(t); setMembers(m.members); setInnovation(m.innovation); setLoading(false);
    });
    return () => { alive = false; };
  }, [projectId]);

  const canManage = project?.my_permissions.can_manage_tasks ?? false;

  async function quickStatus(node: TaskNode, next: TaskStatus) {
    const becameDone = next === "done" && node.status !== "done";
    snack({ type: "success", title: "状態を更新しました", msg: becameDone ? "完了により開発XP＋コインを獲得（接続時に付与）。" : undefined });
    // 試作＝ローカル反映（接続時は PATCH /tasks/{id}）。
    setTasks((cur) => cur ? updateNode(cur, node.id, (n) => ({ ...n, status: next, done_at: next === "done" ? "now" : null })) : cur);
  }
  // 試作＝作成/編集をローカルツリーに反映（接続時は POST/PATCH の応答で置換）。子タスクの子…と任意深さで入れ子可。
  function applyTaskSave(p: TaskSavePayload) {
    const assignee = members.find((m) => m.user.user_id === p.assigneeId)?.user ?? null;
    if (p.id) {
      // 編集＝該当ノードのフィールドを更新（親の付け替えは試作では扱わない）。
      setTasks((cur) => cur ? updateNode(cur, p.id!, (n) => ({ ...n, kind: p.kind, title: p.title, description: p.description || null, assignee, status: p.status, due_date: p.dueDate || null, done_at: p.status === "done" ? (n.done_at ?? "now") : null })) : cur);
      return;
    }
    const projId = tasks?.[0]?.project_id ?? projectId;
    const newNode: TaskNode = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `t-${Math.random().toString(36).slice(2)}`,
      project_id: projId, parent_task_id: p.parentId, kind: p.kind, title: p.title, description: p.description || null,
      assignee, status: p.status, sort_order: 999, due_date: p.dueDate || null, done_at: p.status === "done" ? "now" : null, children: [],
    };
    setTasks((cur) => {
      const base = cur ?? [];
      if (!p.parentId) return [...base, newNode];
      return insertChild(base, p.parentId, newNode);
    });
  }

  async function delTask(node: TaskNode) {
    if (node.children?.length) { snack({ type: "error", title: "子タスクがあります", msg: "先に子タスクを処理してください（409 相当）。" }); return; }
    const ok = await confirm({ variant: "danger", title: "タスクを削除", msg: `「${node.title}」を削除しますか？` });
    if (!ok) return;
    setTasks((cur) => cur ? removeNode(cur, node.id) : cur);
    snack({ type: "success", title: "タスクを削除しました" });
  }

  // ツリーを深さ付きで平坦化＝標準 DataTable の行に載せる（順序はツリー順・インデントで階層を表現）。
  const flatTasks: FlatTask[] = tasks ? flattenTasks(tasks) : [];
  // クイックフィルタ（アイデア一覧と同型）＝すべて/進行中/完了/ブロック/自分のタスク。
  // 自分のタスク＝担当が自分 かつ 完了/ブロック以外（＝これから動くべき自分の仕事）。
  const isMine = (t: FlatTask) => t.assignee?.user_id === DEMO_ME_ID && (t.status === "todo" || t.status === "doing");
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

      {/* ヘッダー（クエスト詳細と同型＝.card ヘッダー） */}
      <section className="card quest-head proj-head" aria-label="プロジェクト情報">
        <div className="proj-head__top">
          {/* クエスト詳細と同じ既定フォント（.quest-head h1）＝page-title の pixel フォントは使わない（ユーザー要望）。 */}
          <h1 style={{ margin: 0 }}>{project.title}</h1>
          <span className={P_STATUS_CLS[project.status]}>{P_STATUS_LABEL[project.status]}</span>
          {project.my_permissions.can_edit && <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: "auto" }} onClick={() => snack({ type: "info", title: "プロジェクト編集", msg: "（試作＝接続時に PATCH /projects/{id}）" })}>編集</button>}
        </div>
        {project.description && <p className="muted" style={{ marginTop: 6 }}>{project.description}</p>}
        <div className="proj-head__meta">
          {project.concept ? <span>由来コンセプト: <Link href={`/concepts/${project.concept.id}`}>{project.concept.title}</Link></span> : <span className="muted">コンセプト非依存（単純タスク管理）</span>}
          {project.quest && <span>由来クエスト: <Link href={`/quests/${project.quest.id}`}>{project.quest.title}</Link></span>}
          <span>所有者: {project.owner.display_name}</span>
          <span>進捗: {project.progress.done}/{project.progress.total}</span>
        </div>
      </section>

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
              ) : members.map((m) => (
                <li className="member-row" key={m.user.user_id}>
                  <Avatar name={m.user.display_name} imageUrl={m.user.avatar_image_url ?? undefined} />
                  <span className="member-name">{m.user.display_name}</span>
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
            {project.my_permissions.can_edit && <button type="button" className="btn btn-outline btn-sm" onClick={() => snack({ type: "info", title: "導入メタ編集", msg: "（試作＝接続時に PATCH /projects/{id} deployment）" })}>編集</button>}
          </div>
          <dl className="proj-deploy">
            <div><dt>ローンチ状態</dt><dd>{project.deployment.launch_status || "—"}</dd></div>
            <div><dt>導入計画</dt><dd>{project.deployment.plan || "—"}</dd></div>
            <div><dt>KPI 実測</dt><dd>{project.deployment.kpi || "—"}</dd></div>
          </dl>
          <p className="hint">{project.concept ? "コンセプト段の viability（コスト/収益/ROI）を導入後の実測で検証し、次サイクルへ（ISO §9/§10）。" : "単純タスク管理でも、導入計画・KPI をメモできます。"}</p>
        </section>
      )}

      {taskForm && tasks && <TaskForm tasks={tasks} members={members} task={taskForm.task} dupFrom={taskForm.dup} defaultParentId={taskForm.parentId} onClose={() => setTaskForm(null)} onSaved={applyTaskSave} />}
      {membersOpen && <ProjectMembersModal members={members} innovation={innovation} onClose={() => setMembersOpen(false)} />}
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

// ツリー更新ヘルパ（試作のローカル反映用）。
function updateNode(nodes: TaskNode[], id: string, fn: (n: TaskNode) => TaskNode): TaskNode[] {
  return nodes.map((n) => (n.id === id ? fn(n) : { ...n, children: updateNode(n.children, id, fn) }));
}
// 指定 parentId のノードの children 末尾に子を追加（任意深さ）。
function insertChild(nodes: TaskNode[], parentId: string, child: TaskNode): TaskNode[] {
  return nodes.map((n) => (n.id === parentId ? { ...n, children: [...n.children, child] } : { ...n, children: insertChild(n.children, parentId, child) }));
}
function removeNode(nodes: TaskNode[], id: string): TaskNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}
