// SC-32 魔法/スキル（ゲーム層）＝SPステータス＋魔法カタログ（系統ごとの段階解放・SP消費で解放）。
// 正＝doc/画面設計/mocks/SC-32_魔法スキル.html・doc/画面設計/screens/SC-32_魔法スキル.md。
// SP/魔法 backend 未実装＝デモ fixtures（画面モック先行）。
import { redirect } from "next/navigation";

import { SpellsView } from "@/features/spells";
import { getServerSession } from "@/lib/session";

export default async function SpellsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <SpellsView />;
}
