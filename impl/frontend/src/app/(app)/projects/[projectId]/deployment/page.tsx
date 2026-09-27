// 導入・価値実現 編集のフルページ・フォールバック（直アクセス/リロード時・§112）。
import { redirect } from "next/navigation";

import { ProjectDeploymentPanel } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectDeploymentFullPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectDeploymentPanel projectId={projectId} />;
}
