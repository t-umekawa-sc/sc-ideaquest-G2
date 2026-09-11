// SC-24 アイデアチャット（フラットリスト・書式/メンション/絵文字/添付・リアクション（通常＋魔法）・引用/編集/削除）。
// 正＝doc/画面設計/mocks/SC-24_アイデアチャット.html・doc/画面設計/screens/SC-24_アイデアチャット.md。
// チャット backend 未実装＝デモ fixtures（フロントエンド実装フロー規約＝画面モック先行）。
import { redirect } from "next/navigation";

import { IdeaChatView } from "@/features/chat";
import { getServerMe } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function IdeaChatPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  // ゲームモード実効値（レビュー#2・§4.11）＝false で魔法キャストUIを無効化（本文は残す）。
  const me = await getServerMe();
  const gameEnabled = me?.game_mode.effective ?? true;
  return <IdeaChatView ideaId={ideaId} gameEnabled={gameEnabled} />;
}
