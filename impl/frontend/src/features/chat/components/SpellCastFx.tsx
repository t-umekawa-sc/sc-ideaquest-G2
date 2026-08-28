"use client";

// 魔法発動の瞬間の one-shot 演出（SC-24・ゲーム感 #10）。対象メッセージ矩形に重ねてエフェクト種別ごとに
// 一撃を出し、そのまま永続 spell-fx へ着地する。座標固定オーバーレイ（カード非依存・スクロールしても短時間で消える）。
// 生成/破棄は親が管理（reduce-motion 時は親が生成しない）。純粋な視覚（aria-hidden）。
export type CastRect = { top: number; left: number; width: number; height: number };

// エフェクト種別→中心に弾ける絵文字（既定 sparkle）。
const CORE: Record<string, string> = {
  fire: "🔥", thunder: "⚡", ice: "❄️", sparkle: "✨", rainbow: "🌈", aura: "🔮",
};

export function SpellCastFx({ rect, effect }: { rect: CastRect; effect: string }) {
  const eff = CORE[effect] ? effect : "sparkle";
  return (
    <div
      className={`spell-cast spell-cast--${eff}`}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      aria-hidden
    >
      <span className="spell-cast__flash" />
      <span className="spell-cast__ring" />
      <span className="spell-cast__core">{CORE[eff]}</span>
      <span className="spell-cast__p spell-cast__p--0">{CORE[eff]}</span>
      <span className="spell-cast__p spell-cast__p--1">{CORE[eff]}</span>
      <span className="spell-cast__p spell-cast__p--2">{CORE[eff]}</span>
    </div>
  );
}
