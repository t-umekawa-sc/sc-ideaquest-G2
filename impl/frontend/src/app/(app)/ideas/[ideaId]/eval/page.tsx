// SC-25 評価画面（プロトタイプ・スタブ）。実体は features/evaluations へ（本番はモーダル差し込みも検討）。
import { ScreenStub } from "@/components/layout";

export default async function IdeaEvalPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  return (
    <ScreenStub
      code="SC-25"
      title={`評価（${ideaId}）`}
      description="5観点★採点＋観点別コメント＋総評＋公開範囲指定・下書き。モック移植予定。"
      links={[{ href: `/ideas/${ideaId}`, label: "アイデア詳細へ戻る（SC-22）" }]}
    />
  );
}
