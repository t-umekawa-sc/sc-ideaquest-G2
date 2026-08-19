// SC-03 プロフィールページ。認証済みユーザー本人のプロフィール（アカウント情報＋残高〔読取〕・編集・セキュリティ）。
// 正＝doc/画面設計/mocks/SC-03_プロフィール.html・doc/画面設計/screens/SC-03_プロフィール.md。
import { redirect } from "next/navigation";

import { ProfileForm, SecuritySection } from "@/features/profile";
import { getServerMe, heroBalance } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 残高（Lv/XP/コイン/SP）＝GET /me 残高（K.1・接続済み）。会社は session から。
  const me = await getServerMe();
  const balance = me ? heroBalance(me.balance) : { level: 1, xpPct: 0, xpToNext: 100, coin: 0, sp: 0 };
  return (
    <div className="profile-page">
      <ProfileForm companyCode={session.company_code} balance={balance} />
      <SecuritySection />
    </div>
  );
}
