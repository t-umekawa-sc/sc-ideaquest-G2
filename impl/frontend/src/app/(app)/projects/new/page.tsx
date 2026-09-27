// SC-70 プロジェクト作成のフルページ・フォールバック（直アクセス/リロード時）。一覧からのソフト遷移は
// @modal/(.)projects/new のモーダルが差し込まれる（Intercept Routes・§112）。?concept= でコンセプト由来起票。
import { redirect } from "next/navigation";

import { ProjectFormPanel } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectCreateFullPage({ searchParams }: { searchParams: Promise<{ concept?: string; conceptTitle?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  return (
    <ProjectFormPanel
      mode="create"
      conceptId={sp.concept ?? null}
      conceptTitle={sp.conceptTitle ?? null}
      ownerName={session.user.display_name}
    />
  );
}
