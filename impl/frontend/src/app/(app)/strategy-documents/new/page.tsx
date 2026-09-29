// SC-81 経営資料 登録/複製（フルページ＝直アクセス/リロード）。?from=<id> で複製（値を引き継ぎ新規作成）。
import { redirect } from "next/navigation";

import { StrategyFormModal } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyNewPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { from } = await searchParams;
  return <StrategyFormModal fromId={from} standalone />;
}
