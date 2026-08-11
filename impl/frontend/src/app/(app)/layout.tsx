// 認証後グループのレイアウト。未認証は /login へ。共通ヘッダー（app-shell）を全画面に敷く。
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout";
import { LogoutAllMenuItem, LogoutMenuItem } from "@/features/auth";
import { getServerSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <>
      <AppHeader user={session.user}>
        {/* メニュー項目は app 層が features から差し込む（プロフィール/設定等は今後追加） */}
        {session.system_role === "system_admin" && (
          <li>
            <Link role="menuitem" href="/admin/companies">システム管理（会社）</Link>
          </li>
        )}
        {session.system_role === "company_account_admin" && (
          <li>
            <Link role="menuitem" href="/admin/accounts">アカウント管理（自社）</Link>
          </li>
        )}
        {/* QG管理者性は per-group（会社DB）でセッションから判定できない＝全員に出し、非該当は画面で「管理グループなし」 */}
        <li>
          <Link role="menuitem" href="/admin/quest-groups">クエストグループ管理</Link>
        </li>
        <li>
          <Link role="menuitem" href="/profile">プロフィール</Link>
        </li>
        <li>
          <LogoutMenuItem />
        </li>
        <li>
          <LogoutAllMenuItem />
        </li>
      </AppHeader>
      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        {children}
      </main>
    </>
  );
}
