// SC-02 通知一覧＝状態/種別の絞り込み＋すべて既読＋日付グループ。参照先（アイデア/チャット/実績）へ遷移。
// 正＝doc/画面設計/mocks/SC-02_通知一覧.html・doc/画面設計/screens/SC-02_通知一覧.md。
// 通知 backend（H）未実装＝デモ fixtures（画面モック先行）。
import { redirect } from "next/navigation";

import { NotificationsView } from "@/features/notifications";
import { getServerMe } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function NotificationsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // ゲームモード実効値（レビュー#2・§4.11）＝false でゲーム系通知（実績/魔法）を一覧から除外。
  const me = await getServerMe();
  const gameEnabled = me?.game_mode.effective ?? true;
  return <NotificationsView gameEnabled={gameEnabled} />;
}
