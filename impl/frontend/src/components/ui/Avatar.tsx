// ユーザアバター（デザイン標準 §4 .avatar）。画像が無ければイニシャル表示。
import Image from "next/image";

type Props = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  level?: number; // 指定時は下部にレベルピル（.avatar__level）を表示
  // 氏名ツールチップ（ホバー/フォーカス）を出さない。氏名が隣に併記済みでツールチップが冗長/被る場合に使う
  // （例＝参加リクエストのプロフィールダイアログ・モーダルの overflow でクリップされるため）。
  noTooltip?: boolean;
};

export function Avatar({ name, imageUrl, size = "md", level, noTooltip = false }: Props) {
  const cls = ["avatar", size !== "md" ? size : ""].filter(Boolean).join(" ");
  const initial = name?.trim().charAt(0) || "?";
  return (
    // tabindex=0＝キーボードフォーカスで氏名ツールチップ（CSS `.avatar[data-name]:focus-visible::after`・デザイン標準 §4）。
    // noTooltip 時は data-name/tabIndex を付けない＝ツールチップ非表示（氏名は呼び出し側で併記済み）。
    <span className={cls} data-name={noTooltip ? undefined : name} tabIndex={noTooltip ? undefined : 0}>
      {imageUrl ? (
        <Image className="avatar__img" src={imageUrl} alt={name} width={48} height={48} />
      ) : (
        <span className="avatar__img placeholder" aria-hidden="true">
          {initial}
        </span>
      )}
      {level != null && <span className="avatar__level">Lv.{level}</span>}
    </span>
  );
}
