// SC-21 アイデア編集のフルページ・フォールバック（直アクセス/リロード時）。
// 下書きカード等からのソフト遷移では @modal/(.)ideas/[ideaId]/edit のモーダルが差し込まれる（Intercept Routes）。
import { redirect } from "next/navigation";

import { IdeaEditPanel } from "@/features/ideas";
import { getServerSession } from "@/lib/session";

export default async function IdeaEditFullPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  return <IdeaEditPanel ideaId={ideaId} locale={session.locale === "en" ? "en" : "ja"} />;
}
