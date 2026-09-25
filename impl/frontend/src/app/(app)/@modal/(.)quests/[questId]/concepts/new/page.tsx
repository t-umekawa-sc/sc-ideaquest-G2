// SC-60 コンセプト登録の URL モーダル（Intercept）。SC-12 コンセプトタブ等からのソフト遷移で差し込む。
import { redirect } from "next/navigation";

import { ConceptCreateModal } from "@/features/concepts";
import { getServerSession } from "@/lib/session";

export default async function ConceptCreateInterceptModal({ params }: { params: Promise<{ questId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { questId } = await params;
  return <ConceptCreateModal questId={questId} />;
}
