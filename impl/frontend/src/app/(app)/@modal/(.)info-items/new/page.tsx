// SC-51 情報の登録の URL 付きモーダル（Intercept Routes）。一覧「＋ 新規登録」・詳細「続報を登録」からの
// ソフト遷移で /info-items/new をこのモーダルに差し込む。直アクセス/リロードは (app)/info-items/new のフルページ。
// ?parent=<id> 指定時は続報（親を引き継ぐ）。
import { redirect } from "next/navigation";

import { InfoFormModal } from "@/features/info-input";
import { getServerSession } from "@/lib/session";

export default async function InfoNewInterceptModal({ searchParams }: { searchParams: Promise<{ parent?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { parent } = await searchParams;
  return <InfoFormModal parentId={parent} />;
}
