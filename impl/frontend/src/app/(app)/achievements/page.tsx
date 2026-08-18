// SC-40 実績/バッジ（ゲーム層）＝収集サマリー＋バッジ一覧（ティア銅銀金・進捗・シークレット）。
// 正＝doc/画面設計/mocks/SC-40_実績バッジ.html・doc/画面設計/screens/SC-40_実績バッジ.md。
// 実績 backend 未実装＝デモ fixtures（画面モック先行）。
import { redirect } from "next/navigation";

import { AchievementsView } from "@/features/achievements";
import { getServerSession } from "@/lib/session";

export default async function AchievementsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <AchievementsView />;
}
