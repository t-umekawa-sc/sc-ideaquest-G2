// SC-21 アイデア登録の URL 付きモーダル（Intercept Routes）。クエスト詳細(/quests/[questId])からのソフト遷移で
// /quests/[questId]/ideas/new をこのモーダルに差し込む。直アクセス/リロードは (app)/quests/[questId]/ideas/new のフルページにフォールバック。
// 正＝mocks/SC-21_アイデア登録編集.html。
import { redirect } from "next/navigation";

import { IdeaCreateModal } from "@/features/ideas";
import { getServerSession } from "@/lib/session";

export default async function IdeaCreateInterceptModal() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <IdeaCreateModal />;
}
