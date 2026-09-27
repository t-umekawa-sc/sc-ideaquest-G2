// SC-61 コンセプト詳細（フルページ・FR-42・P.1 実接続）。
// 正＝doc/画面設計/screens/SC-61_コンセプト詳細.md。session ガードのみ・描画は client の ConceptDetailView。
import { redirect } from "next/navigation";

import { ConceptDetailView } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptDetailPage({ params }: { params: Promise<{ conceptId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { conceptId } = await params;
  return <ConceptDetailView conceptId={conceptId} />;
}
