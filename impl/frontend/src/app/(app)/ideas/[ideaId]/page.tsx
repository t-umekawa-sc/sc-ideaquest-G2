// SC-22 アイデア詳細（本文・価値・添付・投票・評価結果・チャット導線・更新履歴）。
// 正＝doc/画面設計/mocks/SC-22_アイデア詳細.html・doc/画面設計/screens/SC-22_アイデア詳細.md。
// アイデア backend 未実装＝デモ fixtures（フロントエンド実装フロー規約＝画面モック先行）。
import { redirect } from "next/navigation";

import { IdeaDetailView } from "@/features/ideas";
import { getServerSession } from "@/lib/session";

export default async function IdeaDetailPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  return <IdeaDetailView ideaId={ideaId} />;
}
