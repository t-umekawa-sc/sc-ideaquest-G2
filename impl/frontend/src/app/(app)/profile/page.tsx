// SC-03 プロフィールページ。認証済みユーザー本人のプロフィール（アカウント情報＋残高〔読取〕・編集・セキュリティ）。
// 正＝doc/画面設計/mocks/SC-03_プロフィール.html・doc/画面設計/screens/SC-03_プロフィール.md。
import { redirect } from "next/navigation";

import { ProfileForm, SecuritySection } from "@/features/profile";
import { getServerSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 残高（Lv/XP/コイン/SP）は GET /me 残高（K.1）の接続までの demo 値＝共通ヘッダー(layout)の demoBalance と同じ seam。
  // フロントエンド実装フロー規約＝画面モック先行（接続時に fixtures→api へ差し替え）。会社は session から。
  const demoBalance = { level: 7, xpPct: 65, xpToNext: 120, coin: 320, sp: 3 };
  return (
    <div className="profile-page">
      <ProfileForm companyCode={session.company_code} balance={demoBalance} />
      <SecuritySection />
    </div>
  );
}
