// 魔法発動演出（SpellCastFx・SC-24/#10・GF-AC-091）の純ロジック。
// 「中央にアイコンが表示され外側に広がる」放射状の粒子配置と、レアリティ（ランク）が高いほど
// 派手になる強度を決める。視覚は design-system.css の `.spell-cast` 系＋GF-AC でブラウザ受入。
// reduce-motion は呼び出し側（親）が生成を抑制し、CSS でも無効化する（本モジュールは純ロジック）。
// なぜ純ロジックに切り出すか＝粒子数/半径の「ランク差」を vitest で red-green 担保するため（G-TC-151）。

export type CastEffect = "fire" | "thunder" | "ice" | "sparkle" | "rainbow" | "aura";
export type CastTier = "common" | "standard" | "rare";

const EFFECTS: readonly CastEffect[] = ["fire", "thunder", "ice", "sparkle", "rainbow", "aura"];
const TIERS: readonly CastTier[] = ["common", "standard", "rare"];

// 未知の effect は sparkle に畳む（SpellCastFx の既定アイコンと一致）。
export function castEffect(effect: string): CastEffect {
  return (EFFECTS as readonly string[]).includes(effect) ? (effect as CastEffect) : "sparkle";
}

// 未知の rarity は standard 相当に（バッジ表記は common/standard/rare の3段）。
export function castTier(rarity: string): CastTier {
  return (TIERS as readonly string[]).includes(rarity) ? (rarity as CastTier) : "standard";
}

// 外側へ放射する粒子の数＝レアリティが高いほど多い（派手さ）。common 4 / standard 6 / rare 9。
export function castParticleCount(rarity: string): number {
  const tier = castTier(rarity);
  return tier === "rare" ? 9 : tier === "common" ? 4 : 6;
}

export type CastParticle = { dx: number; dy: number; delay: number };

// 中央アイコンから外側へ放射状に広がる粒子の到達座標（px）と発火遅延（秒）。
// 数・半径ともレアリティで増える＝ランクが高いほど広く派手に散る。乱数を使わず決定的。
export function castParticles(rarity: string): CastParticle[] {
  const n = castParticleCount(rarity);
  const tier = castTier(rarity);
  const radius = tier === "rare" ? 68 : tier === "common" ? 44 : 56;
  return Array.from({ length: n }, (_, i) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2; // 真上を起点に等間隔で全周へ
    return {
      dx: Math.round(Math.cos(ang) * radius),
      dy: Math.round(Math.sin(ang) * radius),
      delay: Math.round(i * 12) / 1000, // 0, 0.012, … 秒（わずかにずらして順に弾ける）
    };
  });
}
