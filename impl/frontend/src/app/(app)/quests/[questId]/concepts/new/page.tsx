// SC-60 コンセプト登録のフルページ・フォールバック（直アクセス/リロード）。ソフト遷移は @modal 側モーダル。
import { redirect } from "next/navigation";

import { ConceptCreatePanel } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptCreateFullPage({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return <ConceptCreatePanel questId={questId} />;
}
