// 開発メンバー管理の URL 付きモーダル（Intercept・§112）。詳細からのソフト遷移で /projects/{id}/members を差し込む。
import { redirect } from "next/navigation";

import { ProjectMembersModal } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectMembersInterceptModal({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectMembersModal projectId={projectId} />;
}
