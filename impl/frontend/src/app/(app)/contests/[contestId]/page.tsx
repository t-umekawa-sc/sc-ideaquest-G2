// SC-54 アイデアコンテスト詳細（ドメイン T・FR-46）。SC-12 クエスト詳細を流用（ヘッダー＋アイデアタブ＋表彰台）。
import { redirect } from "next/navigation";

import { ContestDetailView } from "@/features/contests";
import { getServerSession } from "@/lib/session";

export default async function ContestDetailPage({ params }: { params: Promise<{ contestId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { contestId } = await params;
  return <ContestDetailView contestId={contestId} />;
}
