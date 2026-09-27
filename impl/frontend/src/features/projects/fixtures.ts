// デモデータ（モック先行・フロントエンド実装フロー規約 §4）＝backend 接続で api.ts を実 API に差し替える seam。
// 型は types.ts（接続時 OpenAPI codegen へ寄せる）。業務計算はしない（§4.1）。
import type { DemoChatMessage, ProjectDetail, ProjectListItem, ProjectMember, TaskNode, UserRef } from "./types";

const U = (id: string, name: string): UserRef => ({ user_id: id, display_name: name, avatar_image_url: null });

const owner = U("u-sc", "SC開発部管理");
const devLead = U("u-dev1", "田中（開発リード）");
const devMember = U("u-dev2", "佐藤（開発）");
const innov = U("u-inv1", "鈴木（企画）");

// 一覧（SC-70）＝デモ2件。
export const DEMO_PROJECTS: ProjectListItem[] = [
  {
    id: "p-1", title: "スマート勤怠アシスタント 開発", status: "in_progress",
    concept: { id: "c-1", title: "スマート勤怠アシスタント" }, quest: { id: "q-1", title: "勤怠業務の効率化" },
    progress: { done: 2, total: 6 }, task_count: 6, owner, updated_at: "2026-09-26T10:00:00Z",
  },
  {
    id: "p-2", title: "問合せナレッジ基盤 開発", status: "planning",
    concept: { id: "c-2", title: "問合せナレッジ基盤" }, quest: { id: "q-1", title: "勤怠業務の効率化" },
    progress: { done: 0, total: 3 }, task_count: 3, owner, updated_at: "2026-09-25T09:00:00Z",
  },
  {
    id: "p-3", title: "社内イベント運営（単純タスク管理）", status: "in_progress",
    concept: null, quest: null, // コンセプト非依存＝単純タスク管理
    progress: { done: 1, total: 2 }, task_count: 2, owner, updated_at: "2026-09-27T08:00:00Z",
  },
];

export const DEMO_PROJECT_DETAIL: Record<string, ProjectDetail> = {
  "p-1": {
    id: "p-1", title: "スマート勤怠アシスタント 開発", description: "go 判定コンセプトの実行。まず要件を分解し担当を割り当てる。",
    status: "in_progress",
    deployment: { launch_status: "検証中", plan: "社内10部署でパイロット→四半期で全社。", kpi: "問合せ削減率（目標30%）・入力時間（-40%）を月次で実測。" },
    concept: { id: "c-1", title: "スマート勤怠アシスタント" }, quest: { id: "q-1", title: "勤怠業務の効率化" },
    owner, progress: { done: 2, total: 6 }, viewer_domain: "both",
    my_permissions: { can_edit: true, can_manage_members: true, can_manage_tasks: true },
  },
  "p-2": {
    id: "p-2", title: "問合せナレッジ基盤 開発", description: null, status: "planning",
    deployment: { launch_status: "未着手" },
    concept: { id: "c-2", title: "問合せナレッジ基盤" }, quest: { id: "q-1", title: "勤怠業務の効率化" },
    owner, progress: { done: 0, total: 3 }, viewer_domain: "both",
    my_permissions: { can_edit: true, can_manage_members: true, can_manage_tasks: true },
  },
  "p-3": {
    id: "p-3", title: "社内イベント運営（単純タスク管理）", description: "コンセプトに紐づかない単純なタスク管理プロジェクト。", status: "in_progress",
    deployment: {},
    concept: null, quest: null,
    owner, progress: { done: 1, total: 2 }, viewer_domain: "dev",
    my_permissions: { can_edit: true, can_manage_members: true, can_manage_tasks: true },
  },
};

// 開発メンバー（Q.1b）＝開発担当（project_members）。
export const DEMO_MEMBERS: Record<string, { members: ProjectMember[]; innovation: UserRef[] }> = {
  "p-1": {
    members: [
      { user: devLead, role: "lead", added_at: "2026-09-20T00:00:00Z" },
      { user: devMember, role: "member", added_at: "2026-09-21T00:00:00Z" },
    ],
    innovation: [owner, innov], // クエストパーティー＝参照＋口出し可
  },
  "p-2": { members: [], innovation: [owner, innov] },
  "p-3": { members: [{ user: owner, role: "lead", added_at: "2026-09-26T00:00:00Z" }, { user: devMember, role: "member", added_at: "2026-09-26T00:00:00Z" }], innovation: [] },
};

// タスクツリー（Q.2）。
export const DEMO_TASKS: Record<string, TaskNode[]> = {
  "p-1": [
    {
      id: "t-1", project_id: "p-1", parent_task_id: null, kind: "requirement", title: "打刻入力の自動化", description: "スマホ/PC からの打刻を自動化する要件群。",
      assignee: null, status: "doing", sort_order: 0, due_date: "2026-10-15", done_at: null,
      children: [
        { id: "t-1-1", project_id: "p-1", parent_task_id: "t-1", kind: "task", title: "打刻 API 設計", description: null, assignee: devLead, status: "done", sort_order: 0, due_date: "2026-10-01", done_at: "2026-09-30T00:00:00Z", children: [] },
        { id: "t-1-2", project_id: "p-1", parent_task_id: "t-1", kind: "task", title: "打刻画面 実装", description: null, assignee: devMember, status: "doing", sort_order: 1, due_date: "2026-10-10", done_at: null, children: [] },
      ],
    },
    {
      id: "t-2", project_id: "p-1", parent_task_id: null, kind: "requirement", title: "勤怠集計レポート", description: null,
      assignee: null, status: "todo", sort_order: 1, due_date: null, done_at: null,
      children: [
        { id: "t-2-1", project_id: "p-1", parent_task_id: "t-2", kind: "task", title: "集計ロジック", description: null, assignee: null, status: "todo", sort_order: 0, due_date: null, done_at: null, children: [] },
        { id: "t-2-2", project_id: "p-1", parent_task_id: "t-2", kind: "task", title: "レポート出力（CSV/PDF）", description: null, assignee: devMember, status: "done", sort_order: 1, due_date: "2026-10-20", done_at: "2026-09-28T00:00:00Z", children: [] },
        { id: "t-2-3", project_id: "p-1", parent_task_id: "t-2", kind: "task", title: "承認フロー連携", description: null, assignee: null, status: "blocked", sort_order: 2, due_date: null, done_at: null, children: [] },
      ],
    },
  ],
  "p-2": [
    { id: "t-3", project_id: "p-2", parent_task_id: null, kind: "requirement", title: "ナレッジ収集基盤", description: null, assignee: null, status: "todo", sort_order: 0, due_date: null, done_at: null, children: [] },
    { id: "t-4", project_id: "p-2", parent_task_id: null, kind: "requirement", title: "検索 UI", description: null, assignee: null, status: "todo", sort_order: 1, due_date: null, done_at: null, children: [] },
    { id: "t-5", project_id: "p-2", parent_task_id: null, kind: "task", title: "類似度エンジン選定", description: null, assignee: null, status: "todo", sort_order: 2, due_date: null, done_at: null, children: [] },
  ],
  "p-3": [
    { id: "t-6", project_id: "p-3", parent_task_id: null, kind: "task", title: "会場予約", description: null, assignee: owner, status: "done", sort_order: 0, due_date: "2026-10-05", done_at: "2026-09-27T00:00:00Z", children: [] },
    { id: "t-7", project_id: "p-3", parent_task_id: null, kind: "task", title: "案内メール送付", description: null, assignee: devMember, status: "doing", sort_order: 1, due_date: "2026-10-10", done_at: null, children: [] },
  ],
};

// タスクチャットのデモ（両担当同席＝仕様ブレの突き合わせ）。接続時は共有 IdeaChatView（taskSource）へ。
export const DEMO_TASK_CHAT: Record<string, DemoChatMessage[]> = {
  "t-1-2": [
    { id: "m1", author: innov, domain: "innovation", body: "打刻画面、企画では『ワンタップ』想定でした。承認は不要では？", at: "2026-09-24T02:00:00Z" },
    { id: "m2", author: devLead, domain: "dev", body: "実装だと打刻修正時に承認が要るケースがあります。ここは仕様確定したいです。", at: "2026-09-24T02:05:00Z" },
    { id: "m3", author: innov, domain: "innovation", body: "なるほど、修正時のみ承認で合わせましょう。仕様として決めましょう。", at: "2026-09-24T02:10:00Z" },
  ],
};
