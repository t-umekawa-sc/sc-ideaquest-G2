// 導入・価値実現 編集の URL 付きモーダル（Intercept・§112）。詳細からのソフト遷移で /projects/{id}/deployment を差し込む。
import { redirect } from "next/navigation";

import { ProjectDeploymentModal } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectDeploymentInterceptModal({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectDeploymentModal projectId={projectId} />;
}
