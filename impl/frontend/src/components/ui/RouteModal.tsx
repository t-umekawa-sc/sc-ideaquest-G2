"use client";

// Intercept Routes（@modal/(.)…）で使う URL 付きモーダルの薄いラッパ（デザイン標準 §112）。
// intercept ページは常時マウント（＝実質 open）。閉じアニメを見せてから戻るため、local open を false に
// してから AnimatePresence の exit 完了（Modal の onClosed）で router.back() する。
// 子には close 関数を渡す（キャンセル/成功も同じアニメ付き閉じを通す）。
// 直アクセス/リロード時は intercept にマッチせず、対応するフルページ（同一 URL）が表示される。
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Modal } from "./Modal";

type Props = {
  title: string;
  size?: "sm" | "md" | "lg";
  children: (close: () => void) => React.ReactNode;
};

export function RouteModal({ title, size = "md", children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const close = () => setOpen(false); // 閉じ要求＝exit アニメ開始
  return (
    <Modal
      open={open}
      onClose={close}
      onClosed={() => router.back()} // exit 完了＝URL を戻す（モーダルを外す）
      title={title}
      size={size}
    >
      {children(close)}
    </Modal>
  );
}
