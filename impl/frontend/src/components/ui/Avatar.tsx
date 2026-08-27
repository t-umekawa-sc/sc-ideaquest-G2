// ユーザアバター（デザイン標準 §4 .avatar）。画像が無ければイニシャル表示。
import Image from "next/image";

type Props = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  level?: number; // 指定時は下部にレベルピル（.avatar__level）を表示
};

export function Avatar({ name, imageUrl, size = "md", level }: Props) {
  const cls = ["avatar", size !== "md" ? size : ""].filter(Boolean).join(" ");
  const initial = name?.trim().charAt(0) || "?";
  return (
    // tabindex=0＝キーボードフォーカスで氏名ツールチップ（CSS `.avatar[data-name]:focus-visible::after`・デザイン標準 §4）。
    <span className={cls} data-name={name} tabIndex={0}>
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
