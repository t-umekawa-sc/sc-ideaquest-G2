// canvas エンジンの決定的部分（Phase E・G-TC-155）。受入済みモック（style-guide.html §17h）の
// ドット絵スプライトと UFO 軌道を production の canvas ハーネスへ移すにあたり、乱数を含まず
// 決定的に検証できる「スプライトのデコード」と「パターン別軌道」だけをここに切り出す。
// canvas 本体（描画/rAF/spawn の乱数）は非決定的なので GF-AC ブラウザ受入に委ねる。

// ドット絵の円盤スプライト（15×8）。'.'＝透過／'L'＝点滅ライト（色は描画時に動的解決＝colMap に載せない）。
export const UFO_ART = [
  "......ddd......",
  ".....dDDDd.....",
  "....dDDDDDd....",
  ".hHHHHHHHHHHHh.",
  "BBBBBBBBBBBBBBB",
  "BLBBBLBBBLBBBLB",
  ".kkkkkkkkkkkkk.",
  ".....kkkkk.....",
] as const;

export const UFO_COL: Record<string, string> = {
  d: "#d6f2ff",
  D: "#8fd7ff",
  h: "#e8f4ff",
  H: "#c9dcf0",
  B: "#93a6c4",
  k: "#5f7290",
};

export type SpriteCell = { x: number; y: number; char: string; color: string | null };

// スプライト（文字行の配列）を非透過セルの配列へデコード。'.' は除外。colMap に無い文字（'L' 等）は
// 色 null（描画側が動的に解決）。x=行内の列, y=行番号。決定的。
export function decodeSprite(art: readonly string[], colMap: Record<string, string>): SpriteCell[] {
  const cells: SpriteCell[] = [];
  for (let y = 0; y < art.length; y++) {
    const row = art[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row.charAt(x);
      if (ch === ".") continue;
      cells.push({ x, y, char: ch, color: colMap[ch] ?? null });
    }
  }
  return cells;
}

export type UfoParams = { x0: number; x1: number; yBase: number; amp: number; freq: number; H: number };

// UFO の進行 prog(0=画面外の発生側, 1=反対側) からパターン別に画面座標 (x,y) を算出。モック computeUFO 相当。
// x は基本 x0→x1 の線形。y は pat ごとにうねり方が変わる（pat0=直線, 1=うねうね, 2=下ディップ, 3=上山,
// 4=ジグザグ, 5=斜め下, 6=斜め上, 7=途中でループ）。pat 8/9 は prog の進み方で表現するため y は直線扱い。決定的。
export function ufoPosition(pat: number, prog: number, p: UfoParams): { x: number; y: number } {
  let x = p.x0 + (p.x1 - p.x0) * prog;
  let y = p.yBase;
  if (pat === 1) y = p.yBase + Math.sin(prog * Math.PI * p.freq) * p.amp;
  else if (pat === 2) y = p.yBase + Math.sin(prog * Math.PI) * p.amp;
  else if (pat === 3) y = p.yBase - Math.sin(prog * Math.PI) * p.amp;
  else if (pat === 4) {
    const tw = 1 - Math.abs(((prog * p.freq) % 1) * 2 - 1);
    y = p.yBase + (tw - 0.5) * p.amp * 2;
  } else if (pat === 5) y = p.H * 0.12 + p.H * 0.58 * prog;
  else if (pat === 6) y = p.H * 0.62 - p.H * 0.5 * prog;
  else if (pat === 7) {
    if (prog > 0.4 && prog < 0.6) {
      const la = ((prog - 0.4) / 0.2) * Math.PI * 2 - Math.PI / 2;
      x += Math.cos(la) * 20;
      y += Math.sin(la) * 20 + 20;
    }
  }
  return { x, y };
}
