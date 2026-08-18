// SC-30 ショップ（ゲーム層）＝コイン残高＋装備一覧（5スロット・レアリティ・購入＝コイン消費）。
// 正＝doc/画面設計/mocks/SC-30_ショップ.html・doc/画面設計/screens/SC-30_ショップ.md。
// 装備/コイン backend 未実装＝デモ fixtures（画面モック先行）。
import { redirect } from "next/navigation";

import { ShopView } from "@/features/shop";
import { getServerSession } from "@/lib/session";

export default async function ShopPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <ShopView />;
}
