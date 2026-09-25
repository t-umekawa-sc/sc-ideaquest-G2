// SC-62 コンセプト評価のフルページ・フォールバック（直アクセス/リロード）。ソフト遷移は @modal 側モーダル。
import { redirect } from "next/navigation";

import { ConceptEvalPanel } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptEvalFullPage({ params }: { params: Promise<{ conceptId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { conceptId } = await params;
  return <ConceptEvalPanel conceptId={conceptId} />;
}
