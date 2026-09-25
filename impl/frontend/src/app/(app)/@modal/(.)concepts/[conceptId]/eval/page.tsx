// SC-62 コンセプト評価の URL モーダル（Intercept）。SC-61 の「評価する」からのソフト遷移で差し込む。
import { redirect } from "next/navigation";

import { ConceptEvalModal } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptEvalInterceptModal({ params }: { params: Promise<{ conceptId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { conceptId } = await params;
  return <ConceptEvalModal conceptId={conceptId} />;
}
