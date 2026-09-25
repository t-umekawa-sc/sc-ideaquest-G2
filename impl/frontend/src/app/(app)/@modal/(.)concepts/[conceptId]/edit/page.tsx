// SC-60 コンセプト編集の URL モーダル（Intercept）。SC-61 詳細の「編集」からのソフト遷移で差し込む。
import { redirect } from "next/navigation";

import { ConceptEditModal } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptEditInterceptModal({ params }: { params: Promise<{ conceptId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { conceptId } = await params;
  return <ConceptEditModal conceptId={conceptId} />;
}
