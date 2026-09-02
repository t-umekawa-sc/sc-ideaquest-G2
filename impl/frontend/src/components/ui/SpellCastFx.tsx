"use client";

import type { CSSProperties } from "react";
import { castEffect, castTier, castParticles, castBurstKind, castParticleCount, radialBurst } from "@/features/spells/cast";

// 魔法発動の瞬間演出（SC-24・ゲーム感 #10/GF-AC-091）。対象メッセージ矩形に重ねて「中央にエフェクトアイコンが
// 表示され外側へ弾ける」一撃を出し、そのまま永続 spell-fx へ着地する。種別ごとに色/動きが変わり、
// レアリティ（rarity）が高いほど派手に散る（純ロジック＝cast.ts）。
// Phase C: 着弾バーストの幾何を属性別に（雷=放射レイ／氷=結晶シャード／虹=多色リング／炎・オーラ・キラキラ=粒子）。
// 座標固定オーバーレイ（カード非依存・短時間で消える）。生成/破棄は親が管理（reduce-motion 時は親が生成しない＋CSS 無効）。
export type CastRect = { top: number; left: number; width: number; height: number };

// エフェクト種別→中心に弾ける絵文字（既定 sparkle）。
const CORE: Record<string, string> = {
  fire: "🔥", thunder: "⚡", ice: "❄️", sparkle: "✨", rainbow: "🌈", aura: "🔮",
};
// 虹バーストの多色リング（内→外）。
const RING_COLORS = ["#ff004c", "#37ff00", "#00c8ff"];

export function SpellCastFx({ rect, effect, rarity = "standard" }: { rect: CastRect; effect: string; rarity?: string }) {
  const eff = castEffect(effect);
  const tier = castTier(rarity);
  const kind = castBurstKind(effect);
  const parts = castParticles(rarity);
  const n = castParticleCount(rarity);
  // 属性別バーストの幾何（決定的・cast.ts）。数の派手さは rarity 連動。
  const rays = kind === "rays" ? radialBurst(n, 0) : [];
  const shards = kind === "shards" ? radialBurst(n, tier === "rare" ? 62 : 48) : [];
  const showParticles = kind === "plume" || kind === "motes";
  return (
    <div
      className={`spell-cast spell-cast--${eff} spell-cast--r-${tier} spell-cast--b-${kind}`}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      aria-hidden
    >
      <span className="spell-cast__flash" />
      <span className="spell-cast__ring" />
      {/* レア＝広がるリングを二重にして派手さを増す */}
      {tier === "rare" && <span className="spell-cast__ring spell-cast__ring--2" />}
      <span className="spell-cast__core">{CORE[eff]}</span>
      {/* 雷＝中心から放射する稲光レイ（角度は radialBurst） */}
      {rays.map((p, i) => (
        <span key={i} className="spell-cast__ray" style={{ "--rot": `${p.deg + 90}deg` } as CSSProperties} />
      ))}
      {/* 氷＝回転しながら飛散する結晶シャード（到達座標は radialBurst） */}
      {shards.map((p, i) => (
        <span
          key={i}
          className="spell-cast__shard"
          style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--rot": `${p.deg}deg` } as CSSProperties}
        />
      ))}
      {/* 虹＝多色の同心リングが次々に広がる */}
      {kind === "rings" &&
        RING_COLORS.map((c, i) => (
          <span key={i} className="spell-cast__bring" style={{ "--bi": i, borderColor: c } as CSSProperties} />
        ))}
      {/* 炎・オーラ・キラキラ＝中央から外側へ放射状に散る粒子（数・半径はレアリティで増える） */}
      {showParticles &&
        parts.map((p, i) => (
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
