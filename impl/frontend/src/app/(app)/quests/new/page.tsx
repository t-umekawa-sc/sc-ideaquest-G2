// SC-11 クエスト作成のフルページ・フォールバック（直アクセス/リロード時）。
// 一覧からのソフト遷移では @modal/(.)quests/new のモーダルが差し込まれる（Intercept Routes）。
import { ScreenStub } from "@/components/layout";

export default function QuestCreateFullPage() {
  return (
    <ScreenStub
      code="SC-11"
      title="クエスト作成"
      description="直アクセス/リロード時のフルページ表示です。クエスト一覧から開くとモーダルで差し込まれます（URL 付きモーダル）。"
      links={[{ href: "/quests", label: "クエスト一覧へ（SC-10）" }]}
    />
  );
}
