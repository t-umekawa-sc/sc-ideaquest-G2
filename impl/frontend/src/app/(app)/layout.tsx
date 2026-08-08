// 認証後グループのレイアウト。未認証は /login へ。共通ヘッダー（app-shell）を全画面に敷く。
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout";
import { LogoutMenuItem } from "@/features/auth";
import { getServerSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <>
      <AppHeader user={session.user}>
        {/* メニュー項目は app 層が features から差し込む（プロフィール/設定等は今後追加） */}
        <li>
          <LogoutMenuItem />
        </li>
      </AppHeader>
      <main className="container" style={{ paddingBlock: "var(--space-8)" }}>
        {children}
      </main>
    </>
  );
}
