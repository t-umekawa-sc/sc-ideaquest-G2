// SC-81 経営資料 編集の URL 付きモーダル（Intercept Routes）。一覧の行/操作列からのソフト遷移で差し込む。
// 直アクセス/リロードは (app)/strategy-documents/[docId]/edit のフルページ。
import { redirect } from "next/navigation";

import { StrategyFormModal } from "@/features/strategy";
import { getServerSession } from "@/lib/session";

export default async function StrategyEditInterceptModal({ params }: { params: Promise<{ docId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { docId } = await params;
  return <StrategyFormModal docId={docId} />;
}
