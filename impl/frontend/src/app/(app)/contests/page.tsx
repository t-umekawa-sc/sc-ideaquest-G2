// SC-53 アイデアコンテスト一覧（ドメイン T・FR-46）。認可はサーバー強制（read=会社内／作成=contest_create）。
import { redirect } from "next/navigation";

import { ContestListView } from "@/features/contests";
import { getServerSession } from "@/lib/session";

export default async function ContestsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return <ContestListView />;
}
