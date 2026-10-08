// SC-13 発見カタログ（クエスト掲示板）＝発見可能クエストのメタ一覧＋フォロー/参加リクエスト（FR-40・C.9）。
// 正＝doc/画面設計/screens/SC-13_発見カタログ.md・API設計 C.9。一覧はサーバー委譲（§1.8.1）。
import { redirect } from "next/navigation";

import { QuestCatalogView } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestCatalogPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 管理者お勧めトグル（C.9.1）は company_account_admin/system_admin のみ（API も require_company_account_admin で二重防御）。
  const isAdmin = session.system_role === "company_account_admin" || session.system_role === "system_admin";
  return <QuestCatalogView isAdmin={isAdmin} />;
}
