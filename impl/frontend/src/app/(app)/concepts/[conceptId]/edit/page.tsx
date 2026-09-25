// SC-60 コンセプト編集のフルページ・フォールバック（直アクセス/リロード）。ソフト遷移は @modal 側モーダル。
import { redirect } from "next/navigation";

import { ConceptEditPanel } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptEditFullPage({ params }: { params: Promise<{ conceptId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { conceptId } = await params;
  return <ConceptEditPanel conceptId={conceptId} />;
}
