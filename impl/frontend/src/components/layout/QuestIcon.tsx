// クエスト/会社/アイデアアイコン（デザイン標準・shared.css .quest-icon）。カスタム画像 or 頭文字タイル（色＝--accent）。
// 会社アイコン（SC-91/92）・クエストアイコン（SC-10/12）・アイデアアイコン（SC-24/01/12・2026-09-06）で共用。owner オーバーレイは任意。
import Image from "next/image";

type Props = {
  name: string; // 頭文字フォールバック用
  color?: string | null; // タイル色（--accent）。未指定はプライマリ
  imageUrl?: string | null; // 署名URL 等（あれば画像）
  size?: "xs" | "sm" | "lg"; // 既定 56px / xs 24 / sm 40 / lg 72
};

export function QuestIcon({ name, color, imageUrl, size }: Props) {
  const cls = ["quest-icon", size ?? ""].filter(Boolean).join(" ");
  const initial = name?.trim().charAt(0) || "?";
  return (
    <span className={cls}>
      {imageUrl ? (
        <Image className="quest-icon__img" src={imageUrl} alt="" width={56} height={56} />
      ) : (
        <span className="quest-icon__char" style={color ? ({ ["--accent" as string]: color } as React.CSSProperties) : undefined}>
          {initial}
        </span>
      )}
    </span>
  );
}
