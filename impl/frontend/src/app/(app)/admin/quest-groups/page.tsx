// SC-90 クエストグループ管理（QG管理者）ページ。認可は per-group（サーバー）＝任意の認証ユーザーが到達可、
// 管理グループが無ければ画面側で「管理グループなし」を表示（backend は 403）。
import { redirect } from "next/navigation";

import { QuestGroupAdminView } from "@/features/qgadmin";
import { getServerSession } from "@/lib/session";

export default async function QuestGroupsAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <QuestGroupAdminView />;
}
