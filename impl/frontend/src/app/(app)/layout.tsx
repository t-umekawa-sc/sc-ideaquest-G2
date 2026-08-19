// 認証後グループのレイアウト。未認証は /login へ。共通ヘッダー（app-shell）を全画面に敷く。
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout";
import { ConfirmProvider, SnackbarProvider } from "@/components/ui";
import { LogoutAllMenuItem, LogoutMenuItem } from "@/features/auth";
import { getServerMe, headerBalance } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode; // Parallel Route スロット（@modal）＝URL 付きモーダル（Intercept Routes）の差し込み先
}) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 残高（Lv/コイン/SP）＝GET /me（K.1・接続済み）。通知未読数（H）は未接続のため 0（H 接続で差替）。
  const me = await getServerMe();
  const balance = me ? headerBalance(me.balance) : undefined;
  const demoUnread = 0;
  return (
    <SnackbarProvider>
     <ConfirmProvider>
      {/* コンテンツ背景（ユーザー個人設定・全認証画面に反映＝K.4 接続で画像を差す。現状は基底レイヤーのみ） */}
      <div className="app-bg" aria-hidden="true" />
      <AppHeader user={session.user} balance={balance} unreadCount={demoUnread}>
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
      {modal}
     </ConfirmProvider>
    </SnackbarProvider>
  );
}
