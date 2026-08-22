// SC-11 クエスト編集の URL 付きモーダル（Intercept Routes・論点1）。一覧/詳細からのソフト遷移で
// /quests/[questId]/edit をこのモーダルに差し込む。直アクセス/リロードは (app)/quests/[questId]/edit のフルページへ。
// プリフィルは QuestForm が GET /quests/{id} で取得。正＝mocks/SC-11・C.1/C.2。
import { redirect } from "next/navigation";

import { QuestEditModal } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestEditInterceptModal({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return (
    <QuestEditModal
      questId={questId}
      ownerName={session.user.display_name}
      ownerUserId={session.user.user_id}
      locale={session.locale === "en" ? "en" : "ja"}
    />
  );
}
