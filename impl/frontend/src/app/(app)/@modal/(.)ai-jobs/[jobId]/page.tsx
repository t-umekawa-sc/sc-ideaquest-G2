// SC-04 AIジョブ詳細の URL 付きモーダル（Intercept Routes）。一覧の操作列からのソフト遷移で差し込む。
// 直アクセス/リロードは (app)/ai-jobs/[jobId] のフルページ。
import { redirect } from "next/navigation";

import { AiJobDetailModal } from "@/features/ai-jobs";
import { getServerSession } from "@/lib/session";

export default async function AiJobDetailInterceptModal({ params }: { params: Promise<{ jobId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { jobId } = await params;
  return <AiJobDetailModal jobId={jobId} />;
}
