// SC-10 クエスト一覧（プロトタイプ・スタブ）。実体は features/quests へ。
import { ScreenStub } from "@/components/layout";

export default function QuestListPage() {
  return (
    <ScreenStub
      code="SC-10"
      title="クエスト一覧"
      description="所属グループ内で作られ、自分がパーティー参加中のクエスト一覧（モック移植予定）。"
      links={[
        { href: "/quests/new", label: "＋ クエスト作成（SC-11・モーダル）" },
        { href: "/quests/q-001", label: "サンプルのクエスト詳細へ（SC-12）" },
      ]}
    />
  );
}
