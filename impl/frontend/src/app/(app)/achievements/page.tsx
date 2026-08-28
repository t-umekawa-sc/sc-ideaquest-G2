// SC-40 実績/バッジ（ゲーム層）＝収集サマリー＋バッジ一覧（ティア銅銀金・進捗・シークレット）。
// 正＝doc/画面設計/mocks/SC-40_実績バッジ.html・doc/画面設計/screens/SC-40_実績バッジ.md。
// backend 接続済み（GET /achievements・G.4）。accountId はゲーム感 #6 の解放祝福（localStorage 別キー）に使用。
import { redirect } from "next/navigation";

import { AchievementsView } from "@/features/achievements";
import { getServerSession } from "@/lib/session";

export default async function AchievementsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <AchievementsView accountId={session.account_id} />;
}
