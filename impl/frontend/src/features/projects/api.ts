// ソリューション開発（FR-43・ドメイン Q）の取得/更新＝実 API（apiFetch）。型は OpenAPI codegen（schema.d.ts）。
// タスクチャットは共有 IdeaChatView（別ルート）で駆動＝ここでは扱わない（listTaskChat は撤去）。
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type ProjectListItem = components["schemas"]["ProjectListItemDTO"];
export type ProjectDetail = components["schemas"]["ProjectDetailDTO"];
export type TaskNode = components["schemas"]["TaskDTO"];
export type ProjectMember = components["schemas"]["ProjectMemberDTO"];
export type UserRef = components["schemas"]["UserRefDTO"];
export type MembersResponse = components["schemas"]["MembersResponse"];
export type TaskCreateInput = components["schemas"]["TaskCreateRequest"];
export type TaskPatchInput = components["schemas"]["TaskPatchRequest"];
export type ProjectCreateInput = components["schemas"]["ProjectCreateRequest"];
export type ProjectFromConceptInput = components["schemas"]["ProjectCreateFromConceptRequest"];
export type ProjectPatchInput = components["schemas"]["ProjectPatchRequest"];
export type MemberInput = components["schemas"]["MemberInputDTO"];
export type ProjectRole = "lead" | "member";

// ---- projects ----
export async function listProjects(): Promise<ProjectListItem[]> {
  const res = await apiFetch<components["schemas"]["ProjectListResponse"]>("/projects");
  return res?.items ?? [];
}

export function getProject(projectId: string): Promise<ProjectDetail | null> {
  return apiFetch<ProjectDetail>(`/projects/${projectId}`);
}

export function createProject(body: ProjectCreateInput): Promise<ProjectDetail | null> {
  return apiFetch<ProjectDetail>("/projects", { method: "POST", body: JSON.stringify(body) });
}

export function createProjectFromConcept(conceptId: string, body: ProjectFromConceptInput): Promise<ProjectDetail | null> {
  return apiFetch<ProjectDetail>(`/concepts/${conceptId}/project`, { method: "POST", body: JSON.stringify(body) });
}

export function patchProject(projectId: string, body: ProjectPatchInput): Promise<ProjectDetail | null> {
  return apiFetch<ProjectDetail>(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteProject(projectId: string): Promise<unknown> {
  return apiFetch(`/projects/${projectId}`, { method: "DELETE" });
}

// ---- members ----
export async function listProjectMembers(projectId: string): Promise<{ members: ProjectMember[]; innovation: UserRef[] }> {
  const res = await apiFetch<MembersResponse>(`/projects/${projectId}/members`);
  return { members: res?.members ?? [], innovation: res?.innovation_members ?? [] };
}

export function addProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember | null> {
  return apiFetch<ProjectMember>(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ user_id: userId, role }) });
}

export function patchProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<ProjectMember | null> {
  return apiFetch<ProjectMember>(`/projects/${projectId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
}

export function removeProjectMember(projectId: string, userId: string): Promise<unknown> {
  return apiFetch(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
}

// ---- tasks ----
export async function listProjectTasks(projectId: string): Promise<TaskNode[]> {
  const res = await apiFetch<components["schemas"]["TaskTreeResponse"]>(`/projects/${projectId}/tasks`);
  return res?.tree ?? [];
}

export function createTask(projectId: string, body: TaskCreateInput): Promise<TaskNode | null> {
  return apiFetch<TaskNode>(`/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(body) });
}

export function patchTask(taskId: string, body: TaskPatchInput): Promise<TaskNode | null> {
  return apiFetch<TaskNode>(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteTask(taskId: string): Promise<unknown> {
  return apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
}
