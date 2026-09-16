// SC-21 アイデア編集の URL 付きモーダル（Intercept Routes・クエスト編集と対称）。
// ダッシュボードの下書きカード等からのソフト遷移で /ideas/[ideaId]/edit をこのモーダルに差し込む
// （背景はそのまま＝詳細ページへフル遷移しない）。直アクセス/リロードは (app)/ideas/[ideaId]/edit のフルページへ。
import { redirect } from "next/navigation";

import { IdeaEditModal } from "@/features/ideas";
import { getServerSession } from "@/lib/session";

export default async function IdeaEditInterceptModal({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  return <IdeaEditModal ideaId={ideaId} locale={session.locale === "en" ? "en" : "ja"} />;
}
