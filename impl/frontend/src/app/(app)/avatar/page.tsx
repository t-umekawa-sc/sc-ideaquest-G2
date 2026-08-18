// SC-31 アバター/着せ替え（ゲーム層）＝3Dアバタービューア＋ワードローブ（5スロット×装備・クリック着替え）。
// 正＝doc/画面設計/mocks/SC-31_アバター着せ替え.html・doc/画面設計/screens/SC-31_アバター着せ替え.md。
// 装備/コイン backend 未実装＝デモ fixtures（画面モック先行）。
import { redirect } from "next/navigation";

import { AvatarView } from "@/features/avatar";
import { getServerSession } from "@/lib/session";

export default async function AvatarPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <AvatarView />;
}
