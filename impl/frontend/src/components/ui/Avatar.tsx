// ユーザアバター（デザイン標準 §4 .avatar）。画像が無ければイニシャル表示。
import Image from "next/image";

type Props = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
};

export function Avatar({ name, imageUrl, size = "md" }: Props) {
  const cls = ["avatar", size !== "md" ? size : ""].filter(Boolean).join(" ");
  const initial = name?.trim().charAt(0) || "?";
  return (
    <span className={cls} data-name={name}>
      {imageUrl ? (
        <Image className="avatar__img" src={imageUrl} alt={name} width={48} height={48} />
      ) : (
        <span className="avatar__img placeholder" aria-hidden="true">
          {initial}
        </span>
      )}
    </span>
  );
}
