// タスク登録の URL 付きモーダル（Intercept・§112）。WBS からのソフト遷移で /projects/{id}/tasks/new を差し込む。
import { redirect } from "next/navigation";

import { TaskFormModal } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function TaskCreateInterceptModal({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ parent?: string; dup?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  const sp = await searchParams;
  return <TaskFormModal projectId={projectId} parentId={sp.parent ?? null} dupId={sp.dup} />;
}
