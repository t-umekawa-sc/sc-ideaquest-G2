// SC-10 クエスト一覧。所属グループ内で作られ、自分がパーティー参加中のクエスト一覧。
// 正＝doc/画面設計/mocks/SC-10_クエスト一覧.html・doc/画面設計/screens/SC-10_クエスト一覧.md。
import { redirect } from "next/navigation";

import { QuestListView } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestListPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <QuestListView />;
}
