// SC 横断: ページ遷移の登場演出（ゲーム感 #28）。App Router の template はナビゲーション毎に
// 再マウントされるため、遷移のたびにページ本体が軽くフェードインする。chrome（ヘッダー）は layout に
// 残るので遷移しない。**opacity のみ**で表現＝transform は position:fixed の含みブロックを作り、
// 各種オーバーレイ（バースト/フロート/マスコット追従等）の座標を壊すため使わない。
// reduce-motion／アニメ設定（[data-anim-reduced]）での無効化は design-system.css 側。
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-transition">{children}</div>;
}
