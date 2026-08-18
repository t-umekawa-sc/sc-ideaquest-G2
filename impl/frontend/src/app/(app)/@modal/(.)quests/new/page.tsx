// SC-11 クエスト作成の URL 付きモーダル（Intercept Routes・§112）。一覧(/quests)等からのソフト遷移で
// /quests/new をこのモーダルに差し込む。直アクセス/リロードは (app)/quests/new のフルページにフォールバック。
// owner（作成者）は session から取得して client 本体へ渡す。正＝mocks/SC-11。
import { redirect } from "next/navigation";

import { QuestCreateModal } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestCreateInterceptModal() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <QuestCreateModal ownerName={session.user.display_name} />;
}
