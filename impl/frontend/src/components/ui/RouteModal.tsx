"use client";

// Intercept Routes（@modal/(.)…）で使う URL 付きモーダルの薄いラッパ（デザイン標準 §112）。
// intercept ページは常時マウント（＝実質 open）。閉じアニメを見せてから戻るため、local open を false に
// してから AnimatePresence の exit 完了（Modal の onClosed）で router.back() する。
// 子には close 関数を渡す（キャンセル/成功も同じアニメ付き閉じを通す）。
// 直アクセス/リロード時は intercept にマッチせず、対応するフルページ（同一 URL）が表示される。
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Modal } from "./Modal";

type Props = {
  title: string;
  size?: "sm" | "md" | "lg" | "xl";
  // 背景クリック/Esc/× での閉じをガードする（false を返したら閉じない）。未保存の破棄確認などに使う。
  // 子に渡す close はガード無し（保存成功など「確定済み」の閉じ用）＝呼び出し側が必要なら別途ガードする。
  beforeClose?: () => boolean | Promise<boolean>;
  // close(to?) ＝ 確定済みの閉じ。to を渡すと exit アニメ完了後 router.back の代わりに router.replace(to) で
  // 別画面へ遷移する（作成→詳細へ、など）。to 省略時は従来通り router.back（intercept を巻き戻す）。
  children: (close: (to?: string) => void) => React.ReactNode;
};

export function RouteModal({ title, size = "md", beforeClose, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const nextHref = useRef<string | null>(null); // close(to) の遷移先（onClosed で消費）
  const close = (to?: string) => { nextHref.current = to ?? null; setOpen(false); }; // 閉じ要求＝exit アニメ開始
  // 背景/Esc/× は beforeClose を通す（未保存なら破棄確認→キャンセルで閉じない）。
  const requestClose = async () => { if (!beforeClose || (await beforeClose())) setOpen(false); };
  return (
    <Modal
      open={open}
      // exit 完了＝モーダルを外す。to があれば別画面へ（先に open=false でアニメ済＝スロットが残っても不可視）。
      onClosed={() => { if (nextHref.current) router.replace(nextHref.current); else router.back(); }}
      onClose={requestClose}
      title={title}
      size={size}
    >
      {children(close)}
    </Modal>
  );
}
