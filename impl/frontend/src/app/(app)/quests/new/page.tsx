// SC-11 クエスト作成のフルページ・フォールバック（直アクセス/リロード時）。
// 一覧(/quests)からのソフト遷移では @modal/(.)quests/new のモーダルが差し込まれる（Intercept Routes・§112）。
// 正＝doc/画面設計/mocks/SC-11_クエスト作成編集.html。クエスト backend 未実装＝デモ（送信は閉じるのみ）。
import { redirect } from "next/navigation";

import { QuestCreatePanel } from "@/features/quests";
import { getServerSession } from "@/lib/session";

export default async function QuestCreateFullPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <QuestCreatePanel ownerName={session.user.display_name} />;
}
