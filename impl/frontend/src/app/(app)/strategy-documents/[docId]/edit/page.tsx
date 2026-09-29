// SC-81 経営資料 編集（フルページ＝直アクセス/リロード）。一覧からのソフト遷移は @modal intercept。
import { redirect } from "next/navigation";

import { StrategyFormModal } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyEditPage({ params }: { params: Promise<{ docId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { docId } = await params;
  return <StrategyFormModal docId={docId} standalone />;
}
