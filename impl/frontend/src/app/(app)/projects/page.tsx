// SC-70 プロジェクト一覧（フルページ・FR-43・Q.1）。session ガードのみ・描画は client の ProjectListView。
// 正＝doc/画面設計/screens/SC-70_プロジェクト一覧.md。
import { redirect } from "next/navigation";

import { ProjectListView } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <ProjectListView ownerName={session.user.display_name} />;
}
