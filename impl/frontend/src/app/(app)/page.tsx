// SC-01 ダッシュボード（プレースホルダ）。実体は後続で features/dashboard へ。
// レイアウト（共通ヘッダー＋container）は (app)/layout.tsx が提供。
import { redirect } from "next/navigation";

import { Card, CardTitle } from "@/components/ui";
import { getServerSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <Card>
      <CardTitle>ようこそ、{session.user.display_name} さん</CardTitle>
      <p className="muted">会社: {session.company_code}（ダッシュボードは今後実装）</p>
    </Card>
  );
}
