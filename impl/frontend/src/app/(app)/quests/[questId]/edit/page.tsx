// SC-11 クエスト編集のフルページ・フォールバック（直アクセス/リロード時・論点1）。
// 一覧/詳細からのソフト遷移では @modal/(.)quests/[questId]/edit のモーダルが差し込まれる（Intercept Routes）。
// プリフィルは QuestForm が GET /quests/{id} で取得。正＝mocks/SC-11・C.1/C.2。
import { redirect } from "next/navigation";

import { QuestEditPanel } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestEditFullPage({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return (
    <QuestEditPanel
      questId={questId}
      ownerName={session.user.display_name}
      ownerUserId={session.user.user_id}
      locale={session.locale === "en" ? "en" : "ja"}
    />
  );
}
