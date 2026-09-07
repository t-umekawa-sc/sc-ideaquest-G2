// 魔法解放の共通「習得」演出（SC-32・GF-AC-110）の決定的な純ロジック。
// 受入済みモック（doc/画面設計/mocks/style-guide.html §17L-i）を production の canvas ハーネス
// （components/ui/SpellLearnFx.tsx）へ移植。canvas 本体（床の魔法陣→円周の実線→光の円柱に包まれた❓→
// 溜め→解放でアイコン開封→余韻＝rAF 駆動の視覚）は §17L-i／実アプリの GF-AC ブラウザ受入に委ね、
// 決定的に抽出できる「魔法陣の頂点列生成（seed 再現）」「seed 選択」「reduce-motion 分岐」を純関数で担保する（G-TC-162）。

// 円内で反射しながら引く線の本数（頂点は BOUNCES+1 点）。§17L-i と一致。
export const LEARN_BOUNCES = 10;

// 決定的乱数（seed から再現可能）＝選定済みの魔法陣を正確に再生するため。mulberry32。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LearnPoint = { x: number; y: number };

// 魔法陣＝円の内側をランダムに走り、円にぶつかると折れる線の経路（中心相対の頂点列＝LEARN_BOUNCES+1 点・すべて半径 R 上）。
// rng を渡すと再現可能（同 seed→同経路）。中心 C=原点なので P·d<0 が内向き、|P|=R より再交点までの距離 t=-2*(P·d)。
export function genPath(R: number, rng: () => number): LearnPoint[] {
  const pts: LearnPoint[] = [];
  const ang = rng() * 6.2832;
  let px = Math.cos(ang) * R;
  let py = Math.sin(ang) * R;
  pts.push({ x: px, y: py });
  for (let i = 0; i < LEARN_BOUNCES; i++) {
    const da = rng() * 6.2832;
    let dx = Math.cos(da);
    let dy = Math.sin(da);
    if (px * dx + py * dy > 0) {
      dx = -dx;
      dy = -dy;
    }
    const tt = -2 * (px * dx + py * dy);
    px = px + tt * dx;
    py = py + tt * dy;
    pts.push({ x: px, y: py });
  }
  return pts;
}

// ギャラリーで選定済みの魔法陣 seed（この中からランダムに 1 つ再生）。ユーザー選定 10 個・§17L-i の CHOSEN_SEEDS と一致。
export const LEARN_SEEDS = [
  278654891, 2685459059, 3800616262, 3980696776, 2477197827, 2658768710, 554453634, 2799077997, 2231076944, 944679795,
];

// 選定済み seed から 1 つ選ぶ（rand は [0,1)）。範囲端でも配列外にならないようクランプ。
export function pickLearnSeed(rand: number): number {
  const i = Math.min(LEARN_SEEDS.length - 1, Math.max(0, Math.floor(rand * LEARN_SEEDS.length)));
  return LEARN_SEEDS[i];
}

// reduce-motion 分岐の純ロジック（記憶 animation-reduce-motion-standard／デザイン標準 §4.9）。
// 実効抑制（reduceMotion()＝OS reduce OR ユーザー設定・lib/motion の正）なら "static"（演出を出さず即「解放済み」）／非抑制は "animate"。
export type LearnPlan = "static" | "animate";
export function planLearn(reduce: boolean): LearnPlan {
  return reduce ? "static" : "animate";
}
