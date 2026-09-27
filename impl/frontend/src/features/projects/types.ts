// ソリューション開発（FR-43・ISO④⑤）の型（当面ローカル定義＝backend 未実装／接続時に OpenAPI codegen へ寄せる）。
// 正＝doc/API設計/Q_ソリューション開発.md・doc/データモデル.md §5.49-5.53。

export type ProjectStatus = "planning" | "in_progress" | "on_hold" | "done";
export type TaskKind = "requirement" | "task";
export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type ProjectRole = "lead" | "member";
export type MemberDomain = "dev" | "innovation" | "both";

export type UserRef = { user_id: string; display_name: string; avatar_image_url?: string | null };

// 一覧行（SC-70・Q.1）。concept/quest は null 可＝コンセプト非依存の単純タスク管理プロジェクト（FR-43）。
export type ProjectListItem = {
  id: string;
  title: string;
  status: ProjectStatus;
  concept: { id: string; title: string } | null;
  quest: { id: string; title: string } | null;
  progress: { done: number; total: number };
  task_count: number;
  owner: UserRef;
  updated_at: string;
};

// 詳細（SC-71・Q.1）。
export type ProjectDetail = {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  deployment: DeploymentMeta;
  concept: { id: string; title: string } | null;
  quest: { id: string; title: string } | null;
  owner: UserRef;
  progress: { done: number; total: number };
  viewer_domain: MemberDomain;
  my_permissions: { can_edit: boolean; can_manage_members: boolean; can_manage_tasks: boolean };
};

// 導入・価値実現メタ（§3.5・deployment=jsonb）。第一版は自由記述＋状態。
export type DeploymentMeta = {
  launch_status?: string; // 例: 未着手/検証中/本番リリース済
  plan?: string;          // 導入計画メモ
  kpi?: string;           // KPI 実測（自由記述）
};

// 開発メンバー（Q.1b）。
export type ProjectMember = { user: UserRef; role: ProjectRole; added_at: string };

// タスク（Q.2・自己参照ツリー）。
export type TaskNode = {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  kind: TaskKind;
  title: string;
  description: string | null;
  assignee: UserRef | null;
  status: TaskStatus;
  sort_order: number;
  due_date: string | null;
  done_at: string | null;
  children: TaskNode[];
};

// タスク作成/編集の入力（SC-72・Q.2）。
export type TaskInput = {
  parent_task_id?: string | null;
  kind: TaskKind;
  title: string;
  description?: string | null;
  assignee_account_id?: string | null;
  status: TaskStatus;
  due_date?: string | null;
};

// タスクチャットの1メッセージ（試作＝デモ表示。接続時は共有 IdeaChatView〔taskSource〕へ）。
export type DemoChatMessage = { id: string; author: UserRef; domain: "dev" | "innovation"; body: string; at: string };
