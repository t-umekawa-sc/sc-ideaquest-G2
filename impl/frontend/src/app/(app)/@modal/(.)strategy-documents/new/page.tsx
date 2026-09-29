// SC-81 経営資料 登録の URL 付きモーダル（Intercept Routes）。一覧「＋ 経営資料を登録」のソフト遷移で差し込む。
// 直アクセス/リロードは (app)/strategy-documents/new のフルページ。
import { redirect } from "next/navigation";

import { StrategyFormModal } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyNewInterceptModal() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <StrategyFormModal />;
}
