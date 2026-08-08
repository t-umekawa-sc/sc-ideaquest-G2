// SC-01 ダッシュボード（プレースホルダ）。実体は後続で features/dashboard へ。
import { redirect } from "next/navigation";

import { LogoutButton } from "@/features/auth";
import { Card, CardTitle } from "@/components/ui";
import { getServerSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <main style={{ maxWidth: "var(--container)", margin: "var(--space-10) auto", padding: "0 var(--space-4)" }}>
      <Card>
        <CardTitle>ようこそ、{session.user.display_name} さん</CardTitle>
        <p className="muted">会社: {session.company_code}（ダッシュボードは今後実装）</p>
        <div style={{ marginTop: "var(--space-4)" }}>
          <LogoutButton />
        </div>
      </Card>
    </main>
  );
}
