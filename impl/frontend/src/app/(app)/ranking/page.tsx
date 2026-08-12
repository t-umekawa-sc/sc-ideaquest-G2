// SC-41 ランキング（プロトタイプ・スタブ）。実体は features/ranking へ（ゲーム層）。
import { ScreenStub } from "@/components/layout";

export default function RankingPage() {
  return (
    <ScreenStub
      code="SC-41"
      title="ランキング"
      description="全社・期間切替（今週/先週/今月/通算）＋表彰台TOP3＋全件リスト＋自分の順位。モック移植予定。"
    />
  );
}
