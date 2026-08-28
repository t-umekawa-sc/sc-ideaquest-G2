"use client";

// ゲーム感 #20: 3Dアバターのマスコット追従（SC-01 ダッシュボード限定）。
// ホバーしたダッシュボードのカード（.dash-page 内の .card）の右上へ、小さな 3D アバターが
// スプリングで飛んで追従する（§4 マスコットの 3D 版＝今どこでも使われていない 3D アバターに役割を持たせる）。
// 中身は AvatarViewer3D（現状はプレースホルダ／将来 VRM に差し替え＝doc/フェーズ毎ルール/3Dアバター.md）。
// WebGL 非対応・アニメ抑制（OS reduce OR ユーザー設定・§4.9）では出さない（純装飾＝情報ではない）。
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { reduceMotion } from "@/lib/motion";

import type { AvatarBase } from "../base";
import { supportsWebGL } from "../webgl";

const AvatarViewer3D = dynamic(() => import("./AvatarViewer3D").then((m) => m.AvatarViewer3D), { ssr: false });

export function MascotFollower({ base = "male" }: { base?: AvatarBase }) {
  const [enabled, setEnabled] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // WebGL 対応かつアニメ抑制でない時のみ有効（client 判定）。
  useEffect(() => { setEnabled(supportsWebGL() && !reduceMotion()); }, []);

  useEffect(() => {
    if (!enabled) return;
    const dash = document.querySelector<HTMLElement>(".dash-page");
    if (!dash) return;
    const onOver = (e: MouseEvent) => {
      const card = (e.target as HTMLElement)?.closest<HTMLElement>(".card");
      if (!card || !card.closest(".dash-page")) return;
      const r = card.getBoundingClientRect();
      setPos({ top: r.top - 28, left: r.right - 56 }); // カード右上に寄せる
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
      className="mascot3d"
      aria-hidden
      style={{ top: pos?.top ?? -300, left: pos?.left ?? -300, opacity: pos ? 1 : 0 }}
    >
      <AvatarViewer3D base={base} />
    </div>
  );
}
