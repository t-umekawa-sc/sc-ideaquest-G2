// SC-12「パーティー・権限を編集」の URL 付きモーダル（Intercept Routes）。詳細からのソフト遷移で
// /quests/[questId]/party をこのモーダルに差し込む。直アクセス/リロードは (app)/quests/[questId]/party のフルページへ。
// プリフィルは QuestForm が GET /quests/{id} で取得。正＝C.1/C.3・SC-12 パーティータブ。
import { redirect } from "next/navigation";

import { QuestPartyModal } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestPartyInterceptModal({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return (
    <QuestPartyModal
      questId={questId}
      ownerName={session.user.display_name}
      ownerUserId={session.user.user_id}
      locale={session.locale === "en" ? "en" : "ja"}
    />
  );
}
