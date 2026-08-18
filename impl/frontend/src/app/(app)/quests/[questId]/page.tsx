// SC-12 クエスト詳細（クエスト内週間ランキング＋タブ〔アイデア一覧/パーティー/全文検索/概要〕）。
// 正＝doc/画面設計/mocks/SC-12_クエスト詳細.html・doc/画面設計/screens/SC-12_クエスト詳細.md。
// クエスト backend 未実装＝デモ fixtures（フロントエンド実装フロー規約＝画面モック先行）。
import { redirect } from "next/navigation";

import { QuestDetailView } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestDetailPage({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return <QuestDetailView questId={questId} />;
}
