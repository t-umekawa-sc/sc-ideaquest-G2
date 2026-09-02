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

// ── Phase B: 属性別デリバリー（発射方式）の決定的レイアウト（モック §17→production 移植・GF-AC-091） ──
// effect ごとに「飛び方」が変わる。視覚（色/グロー/マズル）は SpellDeliveryFx＋design-system.css。
export type CastDelivery = "ball" | "bolt" | "shards" | "beam" | "crescents";

// fire/sparkle=火球 / thunder=稲妻 / ice=氷礫 / rainbow=ビーム / aura=三日月。未知は sparkle 相当＝ball。
const DELIVERY: Record<CastEffect, CastDelivery> = {
  fire: "ball", sparkle: "ball", thunder: "bolt", ice: "shards", rainbow: "beam", aura: "crescents",
};
export function castDelivery(effect: string): CastDelivery {
  return DELIVERY[castEffect(effect)];
}

// 稲妻のジグザグ折れ線＝進行 t（0=発射元, 1=着弾点）と中心線からの横オフセット off(px)。
// 両端は必ず off=0（発射元/着弾点に接続）、中間は交互に振れる（端に近いほど振幅小＝自然なジグザグ）。決定的。
export type BoltPoint = { t: number; off: number };
export function boltPoints(seg = 6): BoltPoint[] {
  const pts: BoltPoint[] = [];
  for (let i = 0; i <= seg; i++) {
    const edge = i === 0 || i === seg;
    const off = edge ? 0 : (i % 2 ? 1 : -1) * (6 + (i % 3) * 3); // ±6/9/12px を交互に
    pts.push({ t: Math.round((i / seg) * 1000) / 1000, off });
  }
  return pts;
}

// 氷礫＝大小4つの尖った氷片の相対レイアウト（横/縦ズレ・回転・大きさ）。決定的。
export type IceShard = { dx: number; dy: number; rot: number; scale: number };
export function iceShards(): IceShard[] {
  return [
    { dx: -8, dy: -6, rot: -24, scale: 1.0 },
    { dx: 7, dy: -2, rot: 18, scale: 0.7 },
    { dx: -3, dy: 6, rot: 40, scale: 0.85 },
    { dx: 9, dy: 8, rot: -12, scale: 0.6 },
  ];
}

// 三日月の隊列の本数＝発射元→着弾点の距離が長いほど道中で増える（4..9 でクランプ）。GF-AC-091 §17。
export function crescentCount(distance: number): number {
  return Math.max(4, Math.min(9, 4 + Math.round(distance / 60)));
}

// ── Phase C: 着弾バースト（属性別幾何）の決定的レイアウト（モック §17 buildBurst→production 移植・GF-AC-091） ──
// 着弾の瞬間に属性ごとに違う幾何で弾ける。数の派手さは castParticleCount（common<standard<rare）を流用。
export type CastBurstKind = "plume" | "rays" | "shards" | "rings" | "motes";

// fire=噴煙 / thunder=放射レイ / ice=結晶シャード / rainbow=多色リング / aura・sparkle=粒子（motes）。未知は motes。
const BURST: Record<CastEffect, CastBurstKind> = {
  fire: "plume", sparkle: "motes", thunder: "rays", ice: "shards", rainbow: "rings", aura: "motes",
};
export function castBurstKind(effect: string): CastBurstKind {
  return BURST[castEffect(effect)];
}

// 中心から全周へ等間隔・等半径に配る放射レイアウト（レイ/シャード/ドット共通）。既定の起点は真上。決定的。
export type RadialPoint = { deg: number; dx: number; dy: number };
export function radialBurst(n: number, radius: number, startDeg = -90): RadialPoint[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const deg = startDeg + (360 * i) / n;
    const rad = (deg * Math.PI) / 180;
    return { deg: Math.round(deg), dx: Math.round(Math.cos(rad) * radius), dy: Math.round(Math.sin(rad) * radius) };
  });
}

// ── Phase D: 属性別永続エフェクト（buildPersist→production 移植・GF-AC-091 §17） ──
// 炎の永続＝下辺の火柱。8本の左位置(%)・高さ(px)・遅延(s)・周期(s)をばらし、各火柱が根元を軸に首を振る。決定的。
export type FirePillar = { left: number; h: number; delay: number; dur: number };
export function firePillars(): FirePillar[] {
  return [
    { left: 10, h: 12, delay: 0, dur: 0.95 },
    { left: 22, h: 18, delay: -0.25, dur: 1.05 },
    { left: 34, h: 11, delay: -0.5, dur: 0.85 },
    { left: 46, h: 16, delay: -0.15, dur: 1.0 },
    { left: 58, h: 12, delay: -0.35, dur: 0.9 },
    { left: 70, h: 19, delay: -0.05, dur: 1.1 },
    { left: 82, h: 11, delay: -0.45, dur: 0.8 },
    { left: 92, h: 14, delay: -0.2, dur: 0.95 },
  ];
}

// 雷の永続＝落ちる稲妻3本（left%・傾き rot・遅延）＋弾ける電気スパーク2個（left%・top px・遅延）。決定的。
export type ThunderBolt = { left: number; rot: number; delay: number };
export function thunderBolts(): ThunderBolt[] {
  return [
    { left: 20, rot: -8, delay: 0 },
    { left: 52, rot: 6, delay: -0.35 },
    { left: 82, rot: -5, delay: -0.62 },
  ];
}
export type ThunderSpark = { left: number; top: number; delay: number };
export function thunderSparks(): ThunderSpark[] {
  return [
    { left: 8, top: 8, delay: -0.2 },
    { left: 92, top: 12, delay: -0.55 },
  ];
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
