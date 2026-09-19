// SC-51 情報の登録（フルページ＝直アクセス/リロード）。一覧「＋ 新規登録」・詳細「続報を登録」からの
// ソフト遷移は @modal intercept。?parent=<id> 指定時は続報として親を引き継ぐ。
import { redirect } from "next/navigation";

import { InfoFormModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoNewPage({ searchParams }: { searchParams: Promise<{ parent?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { parent } = await searchParams;
  return <InfoFormModal mode="new" parentId={parent} standalone />;
}
