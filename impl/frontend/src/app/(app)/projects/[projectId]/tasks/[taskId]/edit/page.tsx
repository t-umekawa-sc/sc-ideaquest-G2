// タスク編集のフルページ・フォールバック（直アクセス/リロード時・§112）。
import { redirect } from "next/navigation";

import { TaskFormPanel } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function TaskEditFullPage({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId, taskId } = await params;
  return <TaskFormPanel projectId={projectId} taskId={taskId} />;
}
