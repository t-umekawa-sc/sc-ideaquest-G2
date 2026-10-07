// SC-53 アイデアコンテスト一覧（ドメイン T・FR-46）。認可はサーバー強制（read=会社内／作成=contest_create）。
import { redirect } from "next/navigation";

import { ContestListView } from "@/features/contests";
import { getServerMe } from "@/lib/me";
import { getServerSession } from "@/lib/session";

export default async function ContestsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // 公開（コンテスト専用）モード（FR-48 §8.0・決定P）＝ダッシュボードへの逃げ道が無い。
  // backlink（→"/"）と作成導線（一般は 403）を一覧で出し分ける（UI＋サーバー403 の二重封鎖）。
  const me = await getServerMe();
  const publicMode = me?.company.access_mode === "public";
  return <ContestListView publicMode={publicMode} />;
}
