// 認証後グループのレイアウト。未認証は /login へ。共通ヘッダー（app-shell）を全画面に敷く。
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout";
import { LogoutAllMenuItem, LogoutMenuItem } from "@/features/auth";
import { getServerSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 残高（Lv/コイン/SP）・通知未読数は K.1（GET /me 残高）・H（通知）接続までのデモ値。
  // フロントエンド実装フロー規約＝画面モック先行（接続時に fixtures→api へ差し替え）。
  const demoBalance = { level: 7, coin: 320, sp: 3 };
  const demoUnread = 3;
  return (
    <>
      {/* コンテンツ背景（ユーザー個人設定・全認証画面に反映＝K.4 接続で画像を差す。現状は基底レイヤーのみ） */}
      <div className="app-bg" aria-hidden="true" />
      <AppHeader user={session.user} balance={demoBalance} unreadCount={demoUnread}>
        {/* メニュー項目は app 層が features から差し込む */}
        <li role="none">
          <Link role="menuitem" href="/profile">プロフィール</Link>
        </li>
        <li role="none">
          <Link role="menuitem" href="/avatar">アバター / 着せ替え</Link>
        </li>
        <li role="none"><div className="usermenu__sep" /></li>
        {session.system_role === "system_admin" && (
          <li role="none">
            <Link role="menuitem" href="/admin/companies">システム管理（会社）</Link>
          </li>
        )}
        {session.system_role === "company_account_admin" && (
          <li role="none">
            <Link role="menuitem" href="/admin/accounts">アカウント管理（自社）</Link>
          </li>
        )}
        {/* QG管理者（会社DBの有効 admin 所属を1つ以上・ログイン時スナップショット is_qg_admin）にのみ出す */}
        {session.is_qg_admin && (
          <li role="none">
            <Link role="menuitem" href="/admin/quest-groups">クエストグループ管理</Link>
          </li>
        )}
        <li role="none"><div className="usermenu__sep" /></li>
        <li role="none">
          <LogoutMenuItem />
        </li>
        <li role="none">
          <LogoutAllMenuItem />
        </li>
      </AppHeader>
      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        {children}
      </main>
    </>
  );
}
