// SC-41 ランキング（ゲーム層）＝会社内・期間切替（今週/先週/今月/通算）＋表彰台TOP3＋全件＋自分の順位。
// 正＝doc/画面設計/mocks/SC-41_ランキング.html・doc/画面設計/screens/SC-41_ランキング.md。
// ランキング backend 未実装＝デモ fixtures（画面モック先行）。
import { redirect } from "next/navigation";

import { RankingView } from "@/features/ranking";
import { getServerSession } from "@/lib/session";

export default async function RankingPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <RankingView />;
}
