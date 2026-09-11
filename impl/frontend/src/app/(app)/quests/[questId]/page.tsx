// SC-12 クエスト詳細（クエスト内週間ランキング＋タブ〔アイデア一覧/パーティー/全文検索/概要〕）。
// 正＝doc/画面設計/mocks/SC-12_クエスト詳細.html・doc/画面設計/screens/SC-12_クエスト詳細.md。
// クエスト backend 未実装＝デモ fixtures（フロントエンド実装フロー規約＝画面モック先行）。
import { redirect } from "next/navigation";

import { QuestDetailView } from "@/features/quests";
import { getServerMe } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function QuestDetailPage({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  // ゲームモード実効値（§4.11）＝false で KPI/週間ランキング（ゲーム層）を非表示。
  const me = await getServerMe();
  const gameEnabled = me?.game_mode.effective ?? true;
  return <QuestDetailView questId={questId} gameEnabled={gameEnabled} />;
}
