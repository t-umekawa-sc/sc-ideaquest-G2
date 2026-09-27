// プロジェクト編集の URL 付きモーダル（Intercept・§112）。詳細からのソフト遷移で /projects/{id}/edit を差し込む。
import { redirect } from "next/navigation";

import { ProjectFormModal } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectEditInterceptModal({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectFormModal mode="edit" projectId={projectId} ownerName={session.user.display_name} />;
}
