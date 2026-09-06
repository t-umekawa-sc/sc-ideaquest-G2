// オーラエンジン（受入済みモック style-guide.html §17L-g「ライト版・ドット絵」の TS 移植・GF-AC-091）。
// 発動＝術者バッジからドット絵の波動＋前向きな応援記号（♪音符/↑矢印/ハート/星/プラス）がパネル中央へ飛ぶ→
// パネルが強化され縁からドット絵オーラが上へ立ち上る（下辺は控えめ/左右は上ほど強め/上辺は強くライズ・高さはムラ）。
// 色は紫↔金↔青をゆっくり巡回し脈動して残る（文字は透けて読める）。明色パネル向けに彩度寄り配色。
// production 化＝(1) rng 注入、(2) startPersist()（波動/記号の導入なしで強化済みオーラから持続）、(3) resume()（state 保持で rAF 再開）。
// ※オーラは上方向へ大きく立ち上るため canvas を上に高く（MT）＋左右（MS）に張り出す非対称マージン。起点は枠相対 CSS px
//   （useSpellEngine がコンテナ矩形基準で算出）にパネル offset を足して canvas 座標へ変換。決定的部分（グリッド解像度/下辺可読性フェード）は下部の純関数に分離（G-TC-160）。
import type { EngineOpts, SpellEngine } from "./index";

export const AURA_CELL = 8;
export const AURA_MARGIN_TOP_PX = 88;  // 上＝オーラが高く立ち上るぶん大きく張り出す
export const AURA_MARGIN_SIDE_PX = 42; // 左右
export const AURA_MARGIN_BOTTOM_PX = 16; // 下＝控えめ

// 実寸(CSS px)→セルグリッド（gw×gh・約 cell px/セル）。canvas 全体（パネル＋非対称マージン）を覆う。
export function auraGrid(w: number, h: number, cell: number = AURA_CELL): { gw: number; gh: number } {
  return { gw: Math.max(1, Math.ceil((w || 0) / cell)), gh: Math.max(1, Math.ceil((h || 0) / cell)) };
}

// 下辺のオーラ不透明度係数＝最下行付近は控えめ（0.32）で文字を読みやすく／それ以外は 1（可読性の担保）。
export function auraBotFade(gy: number, botRow: number): number {
  return gy >= botRow ? 0.32 : 1;
}

type RGBA = [number, number, number, number];
type Sym = { b: string; col: string; sx: number; sy: number; x: number; y: number; tx: number; ty: number; prog: number; spd: number; ph: number; ps: number };

// 明色パネル向け＝上端を白飛びさせず彩度を保つ（紫/金/青の 3 パレットを巡回）。
const PAL: RGBA[] = [[0, 0, 0, 0], [76, 29, 120, 150], [110, 40, 170, 185], [140, 60, 200, 208], [168, 86, 225, 224], [190, 110, 235, 238], [205, 140, 240, 246], [220, 170, 245, 250], [235, 205, 250, 255]];
const PALG: RGBA[] = [[0, 0, 0, 0], [150, 100, 20, 150], [190, 135, 30, 185], [214, 160, 45, 208], [230, 180, 60, 224], [240, 198, 90, 238], [246, 210, 120, 246], [250, 224, 150, 250], [252, 236, 185, 255]];
const PALB: RGBA[] = [[0, 0, 0, 0], [28, 70, 150, 150], [38, 100, 190, 185], [50, 130, 215, 208], [70, 160, 235, 224], [100, 185, 242, 238], [140, 205, 246, 246], [175, 222, 250, 250], [205, 235, 252, 255]];
const PALS = [PAL, PALG, PALB];
const COLOR_SPEED = 0.008;
const MAXH = PAL.length - 1;
const GLY: Record<string, string[]> = {
  note: ["..##", "..#.", "..#.", "..#.", "###.", "##.."],
  arrow: ["..#..", ".###.", "#####", "..#..", "..#..", "..#.."],
  heart: [".#.#.", "#####", "#####", ".###.", "..#.."],
  star: ["..#..", ".###.", "#####", ".###.", "..#.."],
  plus: ["..#..", "..#..", "#####", "..#..", "..#.."],
};
// 記号色＝明色パネルで読めるよう彩度高め（パステルは避ける）。
const SYMS = [{ b: "note", col: "#d97706" }, { b: "arrow", col: "#059669" }, { b: "note", col: "#ca8a04" }, { b: "heart", col: "#db2777" }, { b: "star", col: "#d97706" }, { b: "arrow", col: "#2563eb" }, { b: "plus", col: "#16a34a" }];

export function createAuraEngine(opts: EngineOpts): SpellEngine {
  const PWpx = Math.max(80, opts.w || 320);
  const PHpx = Math.max(24, opts.h || 110);
  const dpr = opts.dpr || 1;
  const rng = opts.rng ?? Math.random;
  const rnd = (n: number) => rng() * n;
  const MT = AURA_MARGIN_TOP_PX, MS = AURA_MARGIN_SIDE_PX, MB = AURA_MARGIN_BOTTOM_PX, CELL = AURA_CELL;
  const W = PWpx + 2 * MS, H = PHpx + MT + MB;
  const PX = MS, PY = MT, CX = PX + PWpx / 2, CY = PY + PHpx / 2;
  const { gw: GW, gh: GH } = auraGrid(W, H, CELL);

  const canvas = document.createElement("canvas");
  canvas.className = "spell-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // 上に高く＋左右に張り出す非対称マージン（負オフセット）＝オーラが枠外へ立ち上れる。
  canvas.style.width = `calc(100% + ${2 * MS}px)`;
  canvas.style.height = `calc(100% + ${MT + MB}px)`;
  canvas.style.top = `-${MT}px`;
  canvas.style.left = `-${MS}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const PALN: RGBA[] = PAL.map(() => [0, 0, 0, 0]);
  let heat = new Uint8Array(GW * GH);
  let seeds: { i: number; fuel: number }[] = [];
  let state: "idle" | "wave" | "aura" | "static" = "idle";
  let raf: number | null = null, last = 0, acc = 0, t = 0;
  let casterX = W - 6, casterY = MT, dirx = 0, diry = 0;
  let waves: { prog: number }[] = [], spawned = 0, waveTimer = 0;
  const WAVE_GAP = 7, WAVE_SPEED = 0.06, NWAVE = 3;
  let auraGrow = 0; const AURA_RAMP = 0.03;
  let symbols: Sym[] = [], symTimer = 0, symCount = 0; const SYM_MAX = 12;
  const botRow = Math.floor((PY + PHpx) / CELL) - 1;

  function drawGlyph(bmp: string[], cx: number, cy: number, ps: number, color: string, alpha: number) {
    const hh = bmp.length, ww = bmp[0].length, ox = cx - (ww * ps) / 2, oy = cy - (hh * ps) / 2;
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    for (let r = 0; r < hh; r++) for (let c = 0; c < ww; c++) if (bmp[r].charAt(c) === "#") ctx.fillRect(Math.round(ox + c * ps), Math.round(oy + r * ps), ps, ps);
    ctx.globalAlpha = 1;
  }
  function spawnSymbol() {
    const k = SYMS[rnd(SYMS.length) | 0], sx = casterX + (rnd(2) - 1) * 10, sy = casterY + (rnd(2) - 1) * 10;
    symbols.push({ b: k.b, col: k.col, sx, sy, x: sx, y: sy, tx: CX + (rnd(2) - 1) * PWpx * 0.12, ty: CY + (rnd(2) - 1) * PHpx * 0.4, prog: 0, spd: 0.018 + rnd(0.02), ph: rnd(6.28), ps: 2 + (rnd(2) | 0) });
  }
  function updateSymbols() {
    for (let i = symbols.length - 1; i >= 0; i--) {
      const s = symbols[i]; s.prog += s.spd; const e = 1 - (1 - s.prog) * (1 - s.prog);
      s.x = s.sx + (s.tx - s.sx) * e; s.y = s.sy + (s.ty - s.sy) * e + Math.sin(s.ph + s.prog * 9) * 4;
      if (s.prog >= 1) symbols.splice(i, 1);
    }
  }
  function drawSymbols() {
    for (let i = 0; i < symbols.length; i++) { const s = symbols[i], a = s.prog < 0.15 ? s.prog / 0.15 : s.prog > 0.82 ? (1 - s.prog) / 0.18 : 1; drawGlyph(GLY[s.b], s.x, s.y, s.ps, s.col, a * 0.95); }
  }
  function buildSeeds() {
    seeds = [];
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const px = (gx + 0.5) * CELL, py = (gy + 0.5) * CELL;
      const nx = Math.max(PX, Math.min(PX + PWpx, px)), ny = Math.max(PY, Math.min(PY + PHpx, py));
      const ddx = px - nx, ddy = py - ny, dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist <= 0 || dist > CELL * 1.5) continue;
      let vf = (PY + PHpx - py) / PHpx; if (vf < 0) vf = 0; else if (vf > 1) vf = 1;
      let fuel: number;
      if (py < PY) {
        let vv = 2 + 1.6 * Math.sin(gx * 0.5) + Math.sin(gx * 1.7 + 1.3) + 0.6 * Math.sin(gx * 3.1);
        if (vv < 0) vv = 0; else if (vv > 4) vv = 4;
        fuel = MAXH - Math.round(vv);
      } else if (py > PY + PHpx) fuel = 1;
      else fuel = Math.round(2 + (MAXH - 2) * vf);
      seeds.push({ i: gy * GW + gx, fuel });
    }
  }
  function spreadFire(y: number, x: number) {
    const src = y * GW + x, pix = heat[src], ny = y - 1;
    if (pix === 0) { heat[ny * GW + x] = 0; return; }
    const r = (rng() * 3) | 0; let nx = x + (1 - r); if (nx < 0) nx = 0; else if (nx >= GW) nx = GW - 1;
    heat[ny * GW + nx] = Math.max(0, pix - (rng() < 0.85 ? 1 : 0));
  }
  function stepAura() {
    for (let s = 0; s < seeds.length; s++) heat[seeds[s].i] = seeds[s].fuel;
    for (let x = 0; x < GW; x++) for (let y = 1; y < GH; y++) spreadFire(y, x);
  }
  function drawPixelAura() {
    const pulse = 0.82 + 0.18 * Math.sin(t * 0.05), g = Math.min(1, auraGrow) * pulse;
    if (g <= 0.01) return;
    const phase = (t * COLOR_SPEED) % PALS.length, seg = Math.floor(phase), frac = phase - seg;
    const A = PALS[seg], B = PALS[(seg + 1) % PALS.length];
    for (let k = 1; k < PAL.length; k++) { const a = A[k], b = B[k], n = PALN[k]; n[0] = a[0] + (b[0] - a[0]) * frac; n[1] = a[1] + (b[1] - a[1]) * frac; n[2] = a[2] + (b[2] - a[2]) * frac; n[3] = a[3]; }
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i]; if (h <= 0) continue;
      const gy = (i / GW) | 0, botFade = auraBotFade(gy, botRow), col = PALN[h];
      ctx.globalAlpha = (col[3] / 255) * g * botFade; ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      ctx.fillRect((i % GW) * CELL, gy * CELL, CELL, CELL);
    }
    ctx.globalAlpha = 1;
  }
  function drawWave(w: { prog: number }) {
    const e = 1 - (1 - w.prog) * (1 - w.prog), wx = casterX + (CX - casterX) * e, wy = casterY + (CY - casterY) * e;
    const perpx = -diry, perpy = dirx, reach = Math.min(PHpx * 0.55, 38), fade = w.prog < 0.12 ? w.prog / 0.12 : w.prog > 0.9 ? (1 - w.prog) / 0.1 : 1;
    for (let o = -reach; o <= reach; o += CELL) {
      const nb = 1 - (o / reach) * (o / reach), bow = nb * 11;
      const px = wx + perpx * o + dirx * bow, py = wy + perpy * o + diry * bow;
      const lvl = Math.max(1, Math.round(nb * MAXH)), col = PAL[lvl];
      ctx.globalAlpha = (col[3] / 255) * fade; ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillRect(Math.floor(px / CELL) * CELL, Math.floor(py / CELL) * CELL, CELL, CELL);
    }
    ctx.globalAlpha = 1;
  }
  function updateWaves() {
    waveTimer--;
    if (spawned < NWAVE && waveTimer <= 0) { waves.push({ prog: 0 }); spawned++; waveTimer = WAVE_GAP; }
    for (let i = waves.length - 1; i >= 0; i--) { waves[i].prog += WAVE_SPEED; if (waves[i].prog >= 1) waves.splice(i, 1); }
    symTimer--; if (symCount < SYM_MAX && symTimer <= 0) { spawnSymbol(); symCount++; symTimer = 2 + (rnd(2) | 0); }
    if (spawned >= NWAVE && waves.length === 0 && state === "wave") state = "aura";
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawPixelAura();
    if (state === "wave") for (let i = 0; i < waves.length; i++) drawWave(waves[i]);
    drawSymbols();
  }
  function step() {
    t++;
    if (state === "wave") updateWaves();
    if (state === "aura") { if (auraGrow < 1) auraGrow = Math.min(1, auraGrow + AURA_RAMP); stepAura(); }
    updateSymbols();
  }
  function frame(ts: number) { if (!last) last = ts; acc += ts - last; last = ts; while (acc >= 33) { step(); acc -= 33; } render(); raf = requestAnimationFrame(frame); }
  function runLoop() { if (raf == null) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
  function reset() { heat = new Uint8Array(GW * GH); waves = []; spawned = 0; waveTimer = 0; symbols = []; symCount = 0; symTimer = 0; auraGrow = 0; t = 0; buildSeeds(); }

  return {
    canvas,
    start(ox?: number, oy?: number) {
      reset();
      // origin は枠相対 CSS px（0..PWpx/PHpx）で渡る＝パネル offset（PX/PY）を足して canvas 座標へ。既定は枠の右上（術者位置）。
      casterX = ox == null ? PX + PWpx - 6 : PX + ox;
      casterY = oy == null ? PY + 4 : PY + oy;
      const dl = Math.sqrt((CX - casterX) * (CX - casterX) + (CY - casterY) * (CY - casterY)) || 1; dirx = (CX - casterX) / dl; diry = (CY - casterY) / dl;
      state = "wave"; waveTimer = 0; render(); runLoop();
    },
    startPersist() {
      // 履歴＝波動/記号の導入なしで強化済みオーラから持続（以後も脈動/色巡回を続ける）。
      reset();
      state = "aura"; auraGrow = 1; for (let k = 0; k < 30; k++) stepAura(); render(); runLoop();
    },
    resume() { if (raf == null && state !== "idle" && state !== "static") { last = 0; acc = 0; raf = requestAnimationFrame(frame); } },
    reduceStatic() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } reset(); state = "static"; auraGrow = 1; for (let k = 0; k < 30; k++) stepAura(); t = 0; render(); },
    stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } },
  };
}
