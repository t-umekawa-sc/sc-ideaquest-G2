// SC-71 プロジェクト詳細（フルページ・FR-43・Q.1/Q.2/Q.4）。session ガードのみ・描画は client の ProjectDetailView。
// 正＝doc/画面設計/screens/SC-71_プロジェクト詳細.md。
import { redirect } from "next/navigation";

import { ProjectDetailView } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { projectId } = await params;
  return <ProjectDetailView projectId={projectId} />;
}
