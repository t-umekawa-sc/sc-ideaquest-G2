// SC-13 発見カタログ（クエスト掲示板）＝発見可能クエストのメタ一覧＋フォロー/参加リクエスト（FR-40・C.9）。
// 正＝doc/画面設計/screens/SC-13_発見カタログ.md・API設計 C.9。一覧はサーバー委譲（§1.8.1）。
import { redirect } from "next/navigation";

import { QuestCatalogView } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestCatalogPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <QuestCatalogView />;
}
