// SC-01 ダッシュボード。ゲーム層ヒーロー＋週間ランキング＋下書き/未投票/参加中/フォロー中/下段。
// 正＝doc/画面設計/mocks/SC-01_ダッシュボード.html・doc/画面設計/screens/SC-01_ダッシュボード.md。
// ヒーロー残高は GET /me 残高（K.1・接続済み）。週間ランキング/下書き/未投票/参加中等は G/C/D 接続までの demo。
// ロール導線は session で出し分け。
import { redirect } from "next/navigation";

import { DashboardView } from "@/features/dashboard";
import { getServerMe, heroBalance } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const me = await getServerMe();
  // /me が取れない稀ケース（セッション有効中の消失）だけ最小フォールバック。
  const balance = me
    ? heroBalance(me.balance)
    : { level: 1, xpPct: 0, xpToNext: 100, xpInLevel: 0, levelSpan: 100, xp: 0, coin: 0, sp: 0 };
  return (
    <DashboardView
      displayName={session.user.display_name}
      accountId={session.account_id}
      balance={balance}
      admin={{
        systemAdmin: session.system_role === "system_admin",
        companyAdmin: session.system_role === "company_account_admin",
        qgAdmin: session.is_qg_admin,
      }}
    />
  );
}
