// SC-04 AIジョブ詳細（フルページ＝直アクセス/リロード）。一覧からのソフト遷移は @modal intercept。
import { redirect } from "next/navigation";

import { AiJobDetailModal } from "@/features/ai-jobs";
import { getServerSession } from "@/lib/session";

export default async function AiJobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { jobId } = await params;
  return <AiJobDetailModal jobId={jobId} standalone />;
}
