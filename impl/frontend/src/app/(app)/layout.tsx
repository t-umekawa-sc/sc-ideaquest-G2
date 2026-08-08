// 認証後グループのレイアウト。未認証は /login へ（共通ヘッダー等は後続スライスで）。
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}
