"use client";

import type { CSSProperties } from "react";
import { castEffect, firePillars, thunderBolts, thunderSparks, rainbowArcBands } from "@/features/spells/cast";

// Phase D: 属性別の永続エフェクト（モック §17 buildPersist→production）。魔法が着地したメッセージ枠に重ねる。
// 枠の基調グロー/ボーダーは message の `.spell-fx spell-fx--{effect}` クラスが担い、本コンポーネントは
// その上に属性ごとのリッチな装飾（炎＝火柱／…）を注入する。座標オーバーレイ（aria-hidden・純視覚）。
// 幾何は純ロジック（cast.ts）で決定的に組み立て vitest で担保。reduce-motion は CSS で animation 無効（静的）。
// 属性は増分で追加中（現状＝炎。雷/虹/オーラ/氷ツリーは後続の D 増分）。
export function SpellPersistFx({ effect }: { effect: string }) {
  const eff = castEffect(effect);
  if (eff === "fire") {
    return (
      <span className="spell-fx__pillars" aria-hidden>
        <span className="spell-fx__pbase" />
        {firePillars().map((p, i) => (
          <span
            key={i}
            className="spell-fx__peak"
            style={{ left: `${p.left}%`, "--h": `${p.h}px`, "--d": `${p.delay}s`, "--dur": `${p.dur}s` } as CSSProperties}
          />
        ))}
      </span>
    );
  }
  if (eff === "thunder") {
    // 落ちる稲妻＋弾ける電気スパーク（枠の基調ストロボは spell-fx--thunder クラスが担う）。
    return (
      <span className="spell-fx__thunder" aria-hidden>
        {thunderBolts().map((b, i) => (
          <svg key={i} className="spell-fx__bolt" viewBox="0 0 24 70" style={{ left: `${b.left}%`, "--rot": `${b.rot}deg`, animationDelay: `${b.delay}s` } as CSSProperties} aria-hidden>
            <polyline points="13,0 5,26 15,30 3,70" />
          </svg>
        ))}
        {thunderSparks().map((s, i) => (
          <span key={i} className="spell-fx__espark" style={{ left: `${s.left}%`, top: `${s.top}px`, animationDelay: `${s.delay}s` } as CSSProperties} />
        ))}
      </span>
    );
  }
  if (eff === "rainbow") {
    // 上辺の上に架かる全幅アーク（右→左へ clip ワイプで現れる）。枠の色相回転は spell-fx--rainbow クラスが担う。
    return (
      <svg className="spell-fx__arc" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden>
        {rainbowArcBands().map((b, i) => (
          <path key={i} d={b.d} stroke={b.color} />
        ))}
      </svg>
    );
  }
  return null;
}
