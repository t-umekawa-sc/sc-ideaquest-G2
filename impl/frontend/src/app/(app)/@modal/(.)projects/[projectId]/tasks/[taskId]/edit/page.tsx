// タスク編集の URL 付きモーダル（Intercept・§112）。WBS からのソフト遷移で /projects/{id}/tasks/{taskId}/edit を差し込む。
import { redirect } from "next/navigation";

import { TaskFormModal } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function TaskEditInterceptModal({ params }: { params: Promise<{ projectId: string; taskId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId, taskId } = await params;
  return <TaskFormModal projectId={projectId} taskId={taskId} />;
}
