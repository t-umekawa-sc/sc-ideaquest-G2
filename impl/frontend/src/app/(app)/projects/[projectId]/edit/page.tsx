// プロジェクト編集のフルページ・フォールバック（直アクセス/リロード時）。詳細からのソフト遷移は
// @modal/(.)projects/[projectId]/edit のモーダルが差し込まれる（Intercept Routes・§112）。
import { redirect } from "next/navigation";

import { ProjectFormPanel } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectEditFullPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectFormPanel mode="edit" projectId={projectId} ownerName={session.user.display_name} ownerUserId={session.user.user_id ?? undefined} />;
}
