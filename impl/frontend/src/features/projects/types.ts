// ソリューション開発（FR-43）の型。データ形は OpenAPI codegen（api.ts 経由で schema.d.ts）を正とし、
// UI で使う列挙リテラル型・補助型のみローカル定義。
export type { ProjectListItem, ProjectDetail, TaskNode, ProjectMember, UserRef, ProjectRole } from "./api";

export type ProjectStatus = "planning" | "in_progress" | "on_hold" | "done";
export type TaskKind = "requirement" | "task";
export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type MemberDomain = "dev" | "innovation" | "both";

// 導入・価値実現メタ（§3.5・deployment=jsonb）。
export type DeploymentMeta = { launch_status?: string; plan?: string; kpi?: string };
