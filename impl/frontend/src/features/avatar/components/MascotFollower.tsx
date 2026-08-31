"use client";

// ゲーム感 #20（暫定版）: ユーザーのアバターアイコンがダッシュボードのカードに追従する。
// 3D VRM アバターが整うまでの代替＝アイコン画像（未設定は頭文字）を小さく浮かせ、ホバーした
// ダッシュボードのカード（.dash-page 内の .card）右上へスプリングで飛んで追従する。
// 純装飾（aria-hidden）＝アニメ抑制（OS reduce OR ユーザー設定・§4.9）では出さない。
// 将来 3D に差し替え＝doc/フェーズ毎ルール/3Dアバター.md。
import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui";
import { reduceMotion } from "@/lib/motion";

import { mascotFollowEffective } from "../follow";

// follow＝ユーザー設定 accounts.mascot_follow（既定 true）。実効表示は「follow かつ 非抑制」＝
// 「動きを減らす」(OS reduce OR reduce_motion)が立てば follow=true でも出さない（follow.ts）。
export function MascotFollower({ name, imageUrl, follow = true }: { name: string; imageUrl?: string | null; follow?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 実効表示のみ有効（client 判定。アイコンなので WebGL は不要）。抑制 or 追従OFF なら出さない。
  useEffect(() => { setEnabled(mascotFollowEffective(reduceMotion(), follow)); }, [follow]);

  useEffect(() => {
    if (!enabled) return;
    const dash = document.querySelector<HTMLElement>(".dash-page");
    if (!dash) return;
    const onOver = (e: MouseEvent) => {
      const card = (e.target as HTMLElement)?.closest<HTMLElement>(".card");
      if (!card || !card.closest(".dash-page")) return;
      const r = card.getBoundingClientRect();
      setPos({ top: r.top - 30, left: r.right - 44 }); // カード右上に寄せる
    };
    const onLeave = () => setPos(null);
    document.addEventListener("mouseover", onOver);
    dash.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mouseover", onOver);
      dash.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div
      className="mascot-follow"
      aria-hidden
      style={{ top: pos?.top ?? -300, left: pos?.left ?? -300, opacity: pos ? 1 : 0 }}
    >
      <Avatar name={name} imageUrl={imageUrl ?? undefined} size="md" />
    </div>
  );
}
