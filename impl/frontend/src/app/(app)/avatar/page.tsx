// SC-31 アバター/着せ替え（プロトタイプ・スタブ）。実体は features/avatar へ（ゲーム層）。
import { ScreenStub } from "@/components/layout";

export default function AvatarPage() {
  return (
    <ScreenStub
      code="SC-31"
      title="アバター / 着せ替え"
      description="3Dアバタービューア＋ワードローブ（5スロット×装備・クリック着替え）。モック移植予定。"
      links={[{ href: "/shop", label: "ショップへ（SC-30）" }]}
    />
  );
}
