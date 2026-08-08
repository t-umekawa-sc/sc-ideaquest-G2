// SC-01 ダッシュボード（プレースホルダ）。ログインが動くことの確認まで。実体は後続で features/dashboard へ。
import { redirect } from "next/navigation";

import { LogoutButton } from "@/features/auth";
import { getServerSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <main>
      <h1>ようこそ、{session.user.display_name} さん</h1>
      <p>会社: {session.company_code}</p>
      <LogoutButton />
    </main>
  );
}
