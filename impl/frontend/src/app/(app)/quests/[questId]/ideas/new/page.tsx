// SC-21 アイデア登録のフルページ・フォールバック（直アクセス/リロード時）。
// クエスト詳細(/quests/[questId])からのソフト遷移では @modal/(.)quests/[questId]/ideas/new のモーダルが差し込まれる（Intercept Routes）。
// 正＝doc/画面設計/mocks/SC-21_アイデア登録編集.html。アイデア backend 未実装＝デモ（送信は閉じるのみ）。
import { redirect } from "next/navigation";

import { IdeaCreatePanel } from "@/features/ideas";
import { getServerSession } from "@/lib/session";

export default async function IdeaCreateFullPage({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return <IdeaCreatePanel questId={questId} />;
}
