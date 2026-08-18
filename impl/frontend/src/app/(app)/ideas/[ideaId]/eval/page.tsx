// SC-25 評価画面（5観点★採点＋観点別コメント＋総評＋集計プレビュー＋公開範囲）。
// 正＝doc/画面設計/mocks/SC-25_評価画面.html・doc/画面設計/screens/SC-25_評価画面.md。
// 評価 backend 未実装＝デモ fixtures（画面モック先行）。設計上はSC-22からのモーダル（Intercept）／URL直・リロードは本フルページ。
import { redirect } from "next/navigation";

import { EvaluationView } from "@/features/evaluations";
import { getServerSession } from "@/lib/session";

export default async function IdeaEvalPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { ideaId } = await params;
  return <EvaluationView ideaId={ideaId} />;
}
