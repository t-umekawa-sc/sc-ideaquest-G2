// SC-24 アイデアチャット（プロトタイプ・スタブ）。実体は features/chat へ。
import { ScreenStub } from "@/components/layout";

export default async function IdeaChatPage({ params }: { params: Promise<{ ideaId: string }> }) {
  const { ideaId } = await params;
  return (
    <ScreenStub
      code="SC-24"
      title={`アイデアチャット（${ideaId}）`}
      description="アイデア単位のチャット（添付・メンション・魔法リアクション）。モック移植予定。"
      links={[{ href: `/ideas/${ideaId}`, label: "アイデア詳細へ戻る（SC-22）" }]}
    />
  );
}
