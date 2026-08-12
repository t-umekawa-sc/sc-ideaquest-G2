// SC-22 アイデア詳細（プロトタイプ・スタブ）。実体は features/ideas へ。
import { ScreenStub } from "@/components/layout";

export default async function IdeaDetailPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  return (
    <ScreenStub
      code="SC-22"
      title={`アイデア詳細（${ideaId}）`}
      description="本文・価値・添付・投票（賛成/反対）・評価結果・チャット導線。モック移植予定。"
      links={[
        { href: `/ideas/${ideaId}/chat`, label: "アイデアチャットへ（SC-24）" },
        { href: `/ideas/${ideaId}/eval`, label: "評価へ（SC-25）" },
      ]}
    />
  );
}
