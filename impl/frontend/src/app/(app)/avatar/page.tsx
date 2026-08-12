// SC-31 アバター/着せ替え（プロトタイプ・スタブ）。実体は features/avatar へ（ゲーム層・画面群移植フェーズ）。
import { Card, CardTitle } from "@/components/ui";

export default function AvatarPage() {
  return (
    <Card>
      <CardTitle>アバター / 着せ替え（SC-31）</CardTitle>
      <p className="muted">この画面はモック移植予定です（プロトタイプ・スタブ）。</p>
    </Card>
  );
}
