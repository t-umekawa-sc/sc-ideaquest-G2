// ソリューション開発（FR-43）の取得関数＝デモデータ seam（フロントエンド実装フロー規約 §4）。
// 接続フェーズでこの中身を実 API（GET/POST/PATCH /projects・/tasks…＝API設計 Q）に差し替える。
// 画面/コンポーネントはこの関数だけを見る（fixtures か api かを1箇所で切り替え）。
import {
  DEMO_MEMBERS,
  DEMO_PROJECTS,
  DEMO_PROJECT_DETAIL,
  DEMO_TASK_CHAT,
  DEMO_TASKS,
} from "./fixtures";
import type { DemoChatMessage, ProjectDetail, ProjectListItem, ProjectMember, TaskNode, UserRef } from "./types";

const wait = <T,>(v: T): Promise<T> => Promise.resolve(v); // 遅延は入れない（試作）

export function listProjects(): Promise<ProjectListItem[]> {
  return wait(DEMO_PROJECTS);
}

export function getProject(projectId: string): Promise<ProjectDetail | null> {
  return wait(DEMO_PROJECT_DETAIL[projectId] ?? null);
}

export function listProjectTasks(projectId: string): Promise<TaskNode[]> {
  return wait(DEMO_TASKS[projectId] ?? []);
}

export function listProjectMembers(projectId: string): Promise<{ members: ProjectMember[]; innovation: UserRef[] }> {
  return wait(DEMO_MEMBERS[projectId] ?? { members: [], innovation: [] });
}

export function listTaskChat(taskId: string): Promise<DemoChatMessage[]> {
  return wait(DEMO_TASK_CHAT[taskId] ?? []);
}
