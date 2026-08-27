// SC-25 評価の URL 付きモーダル（Intercept Routes）。SC-22 等からのソフト遷移で /ideas/[ideaId]/eval を
// このモーダルに差し込む。直アクセス/リロードは (app)/ideas/[ideaId]/eval のフルページへ。正＝mocks/SC-25・F.2。
import { redirect } from "next/navigation";

import { EvaluationModal } from "@/features/evaluations";
import { getServerSession } from "@/lib/session";

export default async function IdeaEvalInterceptModal({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  return <EvaluationModal ideaId={ideaId} />;
}
