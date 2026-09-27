// タスク登録のフルページ・フォールバック（直アクセス/リロード時・§112）。?parent= 子追加／?dup= 複製。
import { redirect } from "next/navigation";

import { TaskFormPanel } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function TaskCreateFullPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ parent?: string; dup?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  const sp = await searchParams;
  return <TaskFormPanel projectId={projectId} parentId={sp.parent ?? null} dupId={sp.dup} />;
}
