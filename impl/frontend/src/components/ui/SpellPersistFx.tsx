"use client";

import type { CSSProperties } from "react";
import { castEffect, firePillars } from "@/features/spells/cast";

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
  return null;
}
