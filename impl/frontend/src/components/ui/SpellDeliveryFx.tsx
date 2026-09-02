"use client";

import type { CSSProperties } from "react";
import { castEffect, castDelivery, boltPoints, iceShards, crescentCount } from "@/features/spells/cast";

// Phase B: 属性別デリバリー（発射方式）＝発射元 from から対象 to へ「飛ぶ」演出（SC-24・GF-AC-091 §17）。
// fire/sparkle=火球・thunder=稲妻・ice=氷礫・rainbow=ビーム・aura=三日月と、属性で飛び方が変わる。
// 発射元にマズル閃光を出し、進行方向へ回転した軌道上を弾が travel する。着弾の一撃/永続は SpellCastFx/spell-fx が担う。
// 座標固定オーバーレイ（aria-hidden・純視覚）。生成/破棄と reduce-motion 抑制は親が管理（親が生成しない＋CSS でも無効）。
// 幾何は純ロジック（cast.ts＝boltPoints/iceShards/crescentCount）で決定的に組み立て、vitest で担保（G-TC-152）。
export type CastPoint = { x: number; y: number };

export function SpellDeliveryFx({ from, to, effect, rarity = "standard" }: { from: CastPoint; to: CastPoint; effect: string; rarity?: string }) {
  const eff = castEffect(effect);
  const kind = castDelivery(effect);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.round(Math.hypot(dx, dy));
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  // レア＝弾をやや大きく（rarity は当面スケール微調整のみ・数の派手さは着弾側 SpellCastFx が担う）。
  const scale = rarity === "rare" ? 1.2 : rarity === "common" ? 0.9 : 1;
  const style = { left: from.x, top: from.y, "--dist": `${dist}px`, "--ang": `${ang}deg`, "--dscale": scale } as CSSProperties;
  return (
    <div className={`spell-deliver spell-deliver--${eff} spell-deliver--${kind}`} style={style} aria-hidden>
      <span className="spell-deliver__muzzle" />
      <span className="spell-deliver__track">
        {kind === "ball" && <span className="spell-deliver__ball" />}
        {kind === "beam" && <span className="spell-deliver__beam" />}
        {kind === "bolt" && (
          <svg className="spell-deliver__bolt" viewBox="0 0 100 40" preserveAspectRatio="none">
            <polyline points={boltPoints(6).map((p) => `${p.t * 100},${20 + p.off}`).join(" ")} />
          </svg>
        )}
        {kind === "shards" &&
          iceShards().map((s, i) => (
            <span
              key={i}
              className="spell-deliver__shard"
              style={{ "--sdy": `${s.dy}px`, "--srot": `${s.rot}deg`, "--sscale": s.scale } as CSSProperties}
            />
          ))}
        {kind === "crescents" &&
          Array.from({ length: crescentCount(dist) }, (_, i) => (
            <span key={i} className="spell-deliver__crescent" style={{ "--ci": i } as CSSProperties} />
          ))}
      </span>
    </div>
  );
}
