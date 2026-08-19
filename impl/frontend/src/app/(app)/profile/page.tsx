// SC-03 プロフィールページ。認証済みユーザー本人のプロフィール（アカウント情報＋残高〔読取〕・編集・セキュリティ）。
// 正＝doc/画面設計/mocks/SC-03_プロフィール.html・doc/画面設計/screens/SC-03_プロフィール.md。
import Link from "next/link";
import { redirect } from "next/navigation";

import { ActivityHistory, ProfileForm, ProfileHero, SecuritySection } from "@/features/profile";
import { getServerActivities, getServerMe, heroBalance } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 残高（Lv/XP/コイン/SP）＝GET /me 残高（K.1・接続済み）。会社は session から。
  const me = await getServerMe();
  const balance = me
    ? heroBalance(me.balance)
    : { level: 1, xpPct: 0, xpToNext: 100, xpInLevel: 0, levelSpan: 100, xp: 0, coin: 0, sp: 0 };
  // 獲得履歴（G.6・GET /me/activities）＝初回ページをサーバ取得（続きは ActivityHistory がカーソル読込）。
  const activities = await getServerActivities();
  return (
    <div className="profile-page">
      <Link className="backlink" href="/">← ダッシュボードへ戻る</Link>
      <h1 className="page-title">プロフィール</h1>

      {/* 最上部＝ゲーム風パネル：3Dアバター表示グループ＋獲得履歴をまとめて表示。 */}
      <section className="pixel-panel prof-panel" aria-label="プレイヤーステータス">
        <ProfileHero
          displayName={me?.profile.display_name ?? session.user.display_name}
          systemRole={me?.system_role ?? session.system_role}
          balance={balance}
        />
        {activities && (
          <>
            <div className="prof-panel__sep" />
            <ActivityHistory initial={activities} />
          </>
        )}
      </section>

      <ProfileForm companyCode={session.company_code} />
      <SecuritySection />
    </div>
  );
}
