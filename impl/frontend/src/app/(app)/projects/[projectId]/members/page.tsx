// 開発メンバー管理のフルページ・フォールバック（直アクセス/リロード時・§112）。
import { redirect } from "next/navigation";

import { ProjectMembersPanel } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectMembersFullPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectMembersPanel projectId={projectId} />;
}
