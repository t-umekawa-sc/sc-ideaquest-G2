// ゲーム層3画面（SC-30 ショップ / SC-31 きせかえ / SC-32 魔法・スキル）の相互ナビ（デザイン標準）。
// 各画面の見出し直下に置く共通ピル。現在地は非リンク（aria-current="page"）。見た目は design-system.css の .gamenav。
import Link from "next/link";

type GamePage = "shop" | "avatar" | "spells";
const ITEMS: { key: GamePage; href: string; label: string }[] = [
  { key: "shop", href: "/shop", label: "🛒 ショップ" },
  { key: "avatar", href: "/avatar", label: "🧍 きせかえ" },
  { key: "spells", href: "/spells", label: "✦ 魔法・スキル" },
];

export function GameNav({ current }: { current: GamePage }) {
  return (
    <nav className="gamenav" aria-label="ゲーム画面の切り替え">
      {ITEMS.map((i) =>
        i.key === current ? (
          <span className="gamenav__link" aria-current="page" key={i.key}>
            {i.label}
          </span>
        ) : (
          <Link className="gamenav__link" href={i.href} key={i.key}>
            {i.label}
          </Link>
        ),
      )}
    </nav>
  );
}
