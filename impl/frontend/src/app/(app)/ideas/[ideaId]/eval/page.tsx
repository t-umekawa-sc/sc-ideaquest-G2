// SC-25 評価画面（5観点★採点＋観点別コメント＋総評＋集計プレビュー＋公開範囲）。
// 正＝doc/画面設計/mocks/SC-25_評価画面.html・doc/画面設計/screens/SC-25_評価画面.md。
// F.2 実接続。SC-22 からのソフト遷移は Intercept モーダル（@modal/(.)ideas/[ideaId]/eval）／URL直・リロードは本フルページ。
import { redirect } from "next/navigation";

import { EvaluationView } from "@/features/evaluations";
import { getServerSession } from "@/lib/session";

export default async function IdeaEvalPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  return <EvaluationView ideaId={ideaId} />;
}
