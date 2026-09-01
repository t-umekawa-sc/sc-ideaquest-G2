"use client";

import type { CSSProperties } from "react";
import { castEffect, castTier, castParticles } from "@/features/spells/cast";

// 魔法発動の瞬間の one-shot 演出（SC-24・ゲーム感 #10/GF-AC-091）。対象メッセージ矩形に重ねて
// 「中央にエフェクトアイコンが表示され外側へ放射状に広がる」一撃を出し、そのまま永続 spell-fx へ着地する。
// 種別ごとに色/動きが変わり、レアリティ（rarity）が高いほど粒子が多く・広く・派手に散る（純ロジック＝cast.ts）。
// 座標固定オーバーレイ（カード非依存・スクロールしても短時間で消える）。生成/破棄は親が管理
// （reduce-motion 時は親が生成しない＋CSS でも無効）。純粋な視覚（aria-hidden）。
export type CastRect = { top: number; left: number; width: number; height: number };

// エフェクト種別→中心に弾ける絵文字（既定 sparkle）。
const CORE: Record<string, string> = {
  fire: "🔥", thunder: "⚡", ice: "❄️", sparkle: "✨", rainbow: "🌈", aura: "🔮",
};

export function SpellCastFx({ rect, effect, rarity = "standard" }: { rect: CastRect; effect: string; rarity?: string }) {
  const eff = castEffect(effect);
  const tier = castTier(rarity);
  const parts = castParticles(rarity);
  return (
    <div
      className={`spell-cast spell-cast--${eff} spell-cast--r-${tier}`}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      aria-hidden
    >
      <span className="spell-cast__flash" />
      <span className="spell-cast__ring" />
      {/* レア＝広がるリングを二重にして派手さを増す */}
      {tier === "rare" && <span className="spell-cast__ring spell-cast__ring--2" />}
      <span className="spell-cast__core">{CORE[eff]}</span>
      {/* 中央から外側へ放射状に散る粒子（数・半径はレアリティで増える） */}
      {parts.map((p, i) => (
        <span
          key={i}
          className="spell-cast__p"
          style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, animationDelay: `${p.delay}s` } as CSSProperties}
        >
          {CORE[eff]}
        </span>
      ))}
    </div>
  );
}
