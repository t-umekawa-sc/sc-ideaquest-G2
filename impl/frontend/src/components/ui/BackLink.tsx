"use client";

// フローティング（sticky）の戻るリンク（デザイン標準 §4.10）。クリックで**呼び出し元へ履歴戻り**
// （`backToListOr`＝履歴があれば router.back()／無ければ fallbackHref）。server component のページからも
// 使えるよう client 部品として切り出す（各画面のインライン実装と同じ挙動を共通化）。
import Link from "next/link";
import { useRouter } from "next/navigation";

import { backToListOr } from "@/lib/nav";

export function BackLink({
  fallbackHref = "/",
  label = "← 戻る",
  float = true,
}: {
  fallbackHref?: string;
  label?: string;
  float?: boolean;
}) {
  const router = useRouter();
  return (
    <Link
      className={"backlink" + (float ? " backlink--float" : "")}
      href={fallbackHref}  // 右クリック/新規タブ/JS 無効時のフォールバック（素の遷移先）
      onClick={(e) => {
        e.preventDefault();
        backToListOr(router, fallbackHref);
      }}
    >
      {label}
    </Link>
  );
}
