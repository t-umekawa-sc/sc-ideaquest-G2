// SC-70 プロジェクト作成の URL 付きモーダル（Intercept・§112）。一覧からのソフト遷移で /projects/new を差し込む。
// 直アクセス/リロードは (app)/projects/new のフルページにフォールバック。?concept= でコンセプト由来起票。
import { redirect } from "next/navigation";

import { ProjectFormModal } from "@/features/projects";
import { getServerSession } from "@/lib/session";

export default async function ProjectCreateInterceptModal({ searchParams }: { searchParams: Promise<{ concept?: string; conceptTitle?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  return (
    <ProjectFormModal
      mode="create"
      conceptId={sp.concept ?? null}
      conceptTitle={sp.conceptTitle ?? null}
      ownerName={session.user.display_name}
      ownerUserId={session.user.user_id ?? undefined}
    />
  );
}
