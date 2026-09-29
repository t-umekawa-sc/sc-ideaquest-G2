// SC-81 経営資料 登録（フルページ＝直アクセス/リロード）。一覧「＋ 経営資料を登録」からのソフト遷移は @modal intercept。
import { redirect } from "next/navigation";

import { StrategyFormModal } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyNewPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <StrategyFormModal standalone />;
}
