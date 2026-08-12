// SC-12 クエスト詳細（アイデア一覧を内包・プロトタイプ・スタブ）。実体は features/quests へ。
import { ScreenStub } from "@/components/layout";

export default async function QuestDetailPage({ params }: { params: Promise<{ questId: string }> }) {
  const { questId } = await params;
  return (
    <ScreenStub
      code="SC-12"
      title={`クエスト詳細（${questId}）`}
      description="クエスト内週間ランキング＋タブ（アイデア一覧/パーティー/全文検索/概要）。モック移植予定。"
      links={[{ href: "/ideas/i-001", label: "サンプルのアイデア詳細へ（SC-22）" }]}
    />
  );
}
