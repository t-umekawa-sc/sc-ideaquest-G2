// SC-01 ダッシュボード。ゲーム層ヒーロー＋週間ランキング＋下書き/未投票/参加中/フォロー中/下段。
// 正＝doc/画面設計/mocks/SC-01_ダッシュボード.html・doc/画面設計/screens/SC-01_ダッシュボード.md。
// フロントエンド実装フロー規約＝画面モック先行（デモデータ）。残高は GET /me 残高（K.1）接続までの demo 値
// ＝共通ヘッダー(layout)の demoBalance と同型 seam。ロール導線は session で出し分け。
import { redirect } from "next/navigation";

import { DashboardView } from "@/features/dashboard";
import { getServerSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const demoBalance = { level: 7, xpPct: 65, xpToNext: 120, coin: 320, sp: 3 };
  return (
    <DashboardView
      displayName={session.user.display_name}
      balance={demoBalance}
      admin={{
        systemAdmin: session.system_role === "system_admin",
        companyAdmin: session.system_role === "company_account_admin",
        qgAdmin: session.is_qg_admin,
      }}
    />
  );
}
