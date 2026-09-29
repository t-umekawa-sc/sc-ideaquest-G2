// SC-80 経営資料 一覧（ドメイン R・FR-44・会社アカウント管理者）。認可はサーバー強制（一般は API 403）。
import { redirect } from "next/navigation";

import { StrategyListView } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyDocumentsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <StrategyListView />;
}
