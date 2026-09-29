// SC-81 経営資料 登録/複製の URL 付きモーダル（Intercept）。?from=<id> で複製。直アクセス/リロードはフルページ。
import { redirect } from "next/navigation";

import { StrategyFormModal } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyNewInterceptModal({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { from } = await searchParams;
  return <StrategyFormModal fromId={from} />;
}
