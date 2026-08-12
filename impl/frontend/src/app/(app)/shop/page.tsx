// SC-30 ショップ（プロトタイプ・スタブ）。実体は features/shop へ（ゲーム層）。
import { ScreenStub } from "@/components/layout";

export default function ShopPage() {
  return (
    <ScreenStub
      code="SC-30"
      title="ショップ"
      description="コイン残高＋装備グリッド（5スロット・レアリティ・購入＝コイン消費）。モック移植予定。"
      links={[{ href: "/avatar", label: "アバター / 着せ替えへ（SC-31）" }]}
    />
  );
}
