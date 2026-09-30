// SC-04 AI処理状況（ドメイン S・FR-45・認証済みユーザー・自分のジョブのみ）。認可はサーバー強制（S.0）。
import { redirect } from "next/navigation";

import { AiJobsListView } from "@/features/ai-jobs";
import { getServerSession } from "@/lib/session";

export default async function AiJobsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <AiJobsListView />;
}
