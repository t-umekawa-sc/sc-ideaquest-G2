// SC-12「パーティー・権限を編集」のフルページ・フォールバック（直アクセス/リロード時）。
// 詳細からのソフト遷移では @modal/(.)quests/[questId]/party のモーダルが差し込まれる（Intercept Routes）。
// プリフィルは QuestForm が GET /quests/{id} で取得。正＝C.1/C.3・SC-12 パーティータブ。
import { redirect } from "next/navigation";

import { QuestPartyPanel } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestPartyFullPage({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return (
    <QuestPartyPanel
      questId={questId}
      ownerName={session.user.display_name}
      ownerUserId={session.user.user_id}
      locale={session.locale === "en" ? "en" : "ja"}
    />
  );
}
