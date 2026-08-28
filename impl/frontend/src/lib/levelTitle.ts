// レベル→称号/ティアの純ロジック（SC-01・ゲーム感 #21）。視覚（称号表示・ヒーローのオーラ色）は
// DashboardView／dashboard.css 側。しきい値・名称は初期値（後で調整可）。

export type LevelRank = { title: string; tier: string };

// 高い順に判定（最初に min<=level を満たしたものを採用）。tier は dashboard.css の .hero__avatar[data-tier] に対応。
const RANKS: { min: number; title: string; tier: string }[] = [
  { min: 70, title: "伝説", tier: "legend" },
  { min: 50, title: "英雄", tier: "mythic" },
  { min: 35, title: "達人", tier: "master" },
  { min: 20, title: "熟練", tier: "expert" },
  { min: 10, title: "一人前", tier: "adept" },
  { min: 5, title: "駆け出し", tier: "apprentice" },
  { min: 1, title: "見習い", tier: "novice" },
];

/** レベルに対応する称号とティア。0/負/NaN/1未満・小数は 1 扱い（floor・最低 1）。 */
export function levelRank(level: number): LevelRank {
  const lv = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  for (const r of RANKS) if (lv >= r.min) return { title: r.title, tier: r.tier };
  return { title: "見習い", tier: "novice" };
}
