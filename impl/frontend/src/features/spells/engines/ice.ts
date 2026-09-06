// 氷エンジン（受入済みモック style-guide.html §17L-e の TS 移植・GF-AC-091）。
// 発動＝術者バッジから面のある尖った氷塊が飛来→中央で砕けて雪の結晶が飛散→パネルが中央から外へ凍結
// （Voronoi セルが達した所から一気にスナップ凍結＋白い光）→全面凍結後は霜を薄くして可読化＋ランダムセルの
// ピカッが隣へ連鎖→尖った氷結晶クラスタが突然生え、一定保持後に根元→先端へキラッと光ってパリンと割れて破片飛散。
// production 化＝(1) rng 注入、(2) startPersist()（発射なしで凍結済みから持続）、(3) resume()（state 保持で rAF 再開）。
// ※canvas はパネル（メッセージ枠）より一回り大きく（MARGIN）＋負オフセットで張り出す＝氷柱が枠外へはみ出せる
//   （`.spell-fx__layer`/`.msg` は overflow:hidden でない）。起点は枠相対 px（useSpellEngine がコンテナ矩形基準で算出）
//   をマージン offset を足してグリッドへ変換する。決定的部分（解像度/霜の可読性フェード）は下部の純関数に分離（G-TC-158）。
import type { EngineOpts, SpellEngine } from "./index";

export const ICE_SCALE = 3;
export const ICE_MARGIN_PX = 48; // canvas をパネルより張り出す量（CSS px・氷柱のはみ出し代・モック §17L-e と同値）

// 実寸(CSS px)→低解像度グリッド（cols×rows）。ドット絵の解像度（炎/雷と同契約）。
export function iceGrid(w: number, h: number, scale: number = ICE_SCALE): { cols: number; rows: number } {
  return {
    cols: Math.max(140, Math.round((w || 0) / scale)),
    rows: Math.max(20, Math.round((h || 0) / scale)),
  };
}

// 凍ったパネルの霜フィルの不透明度係数。明るいセルほど濃く／settle が下がる（全面凍結後）ほど薄く＝可読性。
export function frostAlpha(bright: number, settle: number): number {
  const a = (13 + bright * 40) * settle;
  return a < 0 ? 0 : a;
}

type Speck = { x: number; y: number; vx: number; vy: number; life: number; ph: number };
type Snow = { x: number; y: number; vx: number; vy: number; life: number; size: number };
type Pillar = { bx: number; by: number; ang: number; L: number; w: number; jag: number[]; grow: number; phase: "grow" | "hold"; hold: number; lit: number; gl: number };
type Frag = { x: number; y: number; vx: number; vy: number; life: number; size: number; lit: number };
type Glint = { cell: number; val: number };
type GlintQ = { cell: number; val: number; delay: number; hops: number; visited: Record<number, 1> };

const ICE_HI: [number, number, number] = [244, 252, 255];
const ICE_CORE: [number, number, number] = [200, 236, 255];
const ICE_MID: [number, number, number] = [120, 190, 238];
const ICE_EDGE: [number, number, number] = [52, 112, 176];
const GL_DUR = 10;

export function createIceEngine(opts: EngineOpts): SpellEngine {
  const PWpx = Math.max(80, opts.w || 320);   // パネル（メッセージ枠）の実寸 CSS px
  const PHpx = Math.max(24, opts.h || 110);
  const rng = opts.rng ?? Math.random;
  const rnd = (n: number) => rng() * n;
  const { cols: PC, rows: PR } = iceGrid(PWpx, PHpx);  // パネルの低解像度グリッド
  const MARG = Math.max(4, Math.round(ICE_MARGIN_PX / ICE_SCALE));  // マージン（グリッドセル）
  const W = PC + 2 * MARG, H = PR + 2 * MARG;          // canvas（パネル＋マージン）
  const PX0 = MARG, PY0 = MARG, PX1 = MARG + PC, PY1 = MARG + PR;   // パネル内領域（この外＝はみ出し領域）
  const CX = MARG + (PC >> 1), CY = MARG + (PR >> 1);  // パネル中央（canvas 座標）

  const canvas = document.createElement("canvas");
  canvas.className = "spell-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = W;
  canvas.height = H;
  // canvas をパネルより一回り大きく張り出す（負オフセット）＝氷柱が枠外へはみ出せる。
  canvas.style.width = `calc(100% + ${2 * ICE_MARGIN_PX}px)`;
  canvas.style.height = `calc(100% + ${2 * ICE_MARGIN_PX}px)`;
  canvas.style.top = `-${ICE_MARGIN_PX}px`;
  canvas.style.left = `-${ICE_MARGIN_PX}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.style.imageRendering = "pixelated";
  canvas.style.filter = "drop-shadow(0 0 5px rgba(56,189,248,.45))"; // 冷たいハロー（明色パネルで浮く）
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(W, H);
  const D = img.data;

  let state: "idle" | "incoming" | "cold" | "static" = "idle";
  let raf: number | null = null, last = 0, acc = 0, t = 0;
  let proj: { x: number; y: number; lit: number } | null = null;
  let axX = 0, axY = 1;
  let snows: Snow[] = [], specks: Speck[] = [], pillars: Pillar[] = [], frags: Frag[] = [];
  let cold = 0, pillarTimer = 0, settle = 1, glintTimer = 60;
  let frost: Uint8Array | null = null;
  let glints: Glint[] = [], glintQueue: GlintQ[] = [], cellAdj: number[][] = [], NCELLS = 0;

  function clear() { for (let i = 0; i < D.length; i++) D[i] = 0; }
  function put(x: number, y: number, r: number, g: number, b: number, a: number) {
    x |= 0; y |= 0; a |= 0; if (a <= 0 || x < 0 || x >= W || y < 0 || y >= H) return;
    const o = (y * W + x) * 4; if (a >= D[o + 3]) { D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = a; }
  }
  function spawnSpeck(x: number, y: number, vx: number, vy: number, life: number) { specks.push({ x, y, vx, vy, life, ph: rnd(6.28) }); }
  function spawnSnowBurst(x: number, y: number, count?: number) {
    const n = count || (14 + (rnd(6) | 0));
    for (let i = 0; i < n; i++) { const a = rnd(6.283), sp = 0.8 + rnd(2.6); snows.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.4, life: 1, size: rnd(1) < 0.5 ? 1 : 2 }); }
  }
  function spawnCluster() {
    // 根元がパネル内に収まる範囲から生える（先端は四方八方へはみ出し可）。
    const inX = Math.min(PC * 0.4, 10), inY = Math.min(PR * 0.4, 8);
    const bx = PX0 + inX + rnd(Math.max(1, PC - 2 * inX)), by = PY0 + inY + rnd(Math.max(1, PR - 2 * inY)), m = 2 + (rnd(3) | 0);
    const baseAng = rnd(6.283);
    spawnSnowBurst(bx, by, 9 + (rnd(6) | 0));
    for (let c = 0; c < m; c++) {
      const ang = baseAng + (c - (m - 1) / 2) * 0.3 + (rnd(1) - 0.5) * 0.14;
      const L = PR * (0.5 + rnd(0.7)), w = 2.4 + rnd(3);
      const n = Math.max(4, (L / 3) | 0), jag: number[] = [];
      for (let i = 0; i <= n; i++) jag.push(0.7 + rnd(0.6));
      pillars.push({ bx: bx + (rnd(7) - 3.5), by: by + (rnd(4) - 2), ang, L, w, jag, grow: 0, phase: "grow", hold: 42 + (rnd(80) | 0), lit: rnd(1) < 0.5 ? 1 : -1, gl: 0 });
    }
  }
  function drawPillar(p: Pillar) {
    const g = p.grow; if (g <= 0.01) return;
    const ax = Math.cos(p.ang), ay = Math.sin(p.ang), nx = -ay, ny = ax, curL = p.L * g;
    const steps = Math.max(2, Math.round(curL)), nj = p.jag.length - 1, lit = p.lit || 1;
    const glP = p.gl > 0 ? (1 - p.gl / GL_DUR) : -1;
    const glBase = p.gl > 0 ? (p.gl / GL_DUR) * 34 : 0;
    for (let i = 0; i <= steps; i++) {
      const tt = i / steps, cx = p.bx + ax * curL * tt, cy = p.by + ay * curL * tt;
      let hw = p.w * (1 - tt * 0.92) * p.jag[(tt * nj) | 0] * (0.55 + g * 0.45); if (hw < 0.5) hw = 0.5;
      const gb = glP >= 0 ? Math.max(0, 1 - Math.abs(tt - glP) / 0.26) : 0;
      const ga = glBase + gb * gb * 220;
      for (let s = -hw; s <= hw; s += 1) {
        const sn = s / (hw + 0.001), asn = Math.abs(sn); let col: [number, number, number];
        if (sn * lit > 0.12 && sn * lit < 0.52) col = ICE_HI;
        else if (asn < 0.26) col = ICE_CORE;
        else if (asn > 0.76) col = ICE_EDGE;
        else col = ICE_MID;
        put(cx + nx * s, cy + ny * s, col[0], col[1], col[2], 132);
        if (ga > 0) put(cx + nx * s, cy + ny * s, 255, 255, 255, Math.min(255, (132 + ga) | 0));
      }
    }
  }
  function spawnShatter(p: Pillar) {
    const ax = Math.cos(p.ang), ay = Math.sin(p.ang), nx = -ay, ny = ax, curL = p.L * p.grow;
    const n = Math.max(3, (curL / 9) | 0);
    for (let i = 0; i <= n; i++) {
      const tt = i / n, cx = p.bx + ax * curL * tt, cy = p.by + ay * curL * tt;
      const side = rnd(1) < 0.5 ? 1 : -1, sp = 0.4 + rnd(1.0) + tt * 0.7;
      const vx = nx * side * sp * (0.5 + rnd(0.7)) + (rnd(1) - 0.5) * 0.7;
      const vy = ny * side * sp * 0.4 - (0.3 + rnd(1.0));
      frags.push({ x: cx, y: cy, vx, vy, life: 0.85, size: rnd(1) < 0.25 ? 2 : 1, lit: p.lit || 1 });
    }
    spawnSnowBurst(p.bx + ax * curL * 0.4, p.by + ay * curL * 0.4, 2 + (rnd(3) | 0));
    for (let s = 0; s < 3; s++) { const a = rnd(6.283), ss = 0.5 + rnd(1.1); spawnSpeck(p.bx, p.by, Math.cos(a) * ss, Math.sin(a) * ss, 1); }
  }
  function drawFrags() {
    for (let i = 0; i < frags.length; i++) {
      const f = frags[i], a = Math.min(1, f.life), sz = f.size, lit = f.lit;
      for (let dy = -sz; dy <= sz; dy++) for (let dx = -sz; dx <= sz; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > sz) continue;
        const edge = Math.abs(dx) + Math.abs(dy) === sz; let col: [number, number, number];
        if (edge) col = ICE_EDGE; else if (dx * lit > 0) col = ICE_HI; else col = ICE_CORE;
        put(f.x + dx, f.y + dy, col[0], col[1], col[2], (a * 205) | 0);
      }
    }
  }
  function buildFrost() {
    // 凍結セル模様は「パネル内（PC×PR）」に作る（マージン部は氷柱のはみ出し用）。
    const ns = Math.max(5, Math.round(PC * PR / 1050)), seeds: { x: number; y: number; ft: number }[] = [], cx = PC / 2, cy = PR / 2, maxD = Math.hypot(cx, cy) || 1;
    for (let i = 0; i < ns; i++) { const sx = rnd(PC), sy = rnd(PR), ft = Math.hypot(sx - cx, sy - cy) / maxD + (rnd(1) - 0.5) * 0.18; seeds.push({ x: sx, y: sy, ft: Math.max(0, Math.min(1, ft)) }); }
    NCELLS = seeds.length;
    frost = new Uint8Array(PC * PR * 4);
    for (let py = 0; py < PR; py++) for (let px = 0; px < PC; px++) {
      let f1 = 1e9, f2 = 1e9, s1 = 0;
      for (let k = 0; k < seeds.length; k++) { const dx = px - seeds[k].x, dy = py - seeds[k].y, d = dx * dx + dy * dy; if (d < f1) { f2 = f1; f1 = d; s1 = k; } else if (d < f2) f2 = d; }
      const edge = Math.sqrt(f2) - Math.sqrt(f1), vein = edge < 2.4 ? (1 - edge / 2.4) : 0, bright = Math.max(0, 1 - Math.sqrt(f1) / 18);
      const idx = (py * PC + px) * 4; frost[idx] = (vein * 255) | 0; frost[idx + 1] = (bright * 255) | 0; frost[idx + 2] = (seeds[s1].ft * 255) | 0; frost[idx + 3] = s1 & 255;
    }
    const seen: Record<number, 1>[] = []; for (let c = 0; c < NCELLS; c++) seen.push({});
    cellAdj = []; for (let c2 = 0; c2 < NCELLS; c2++) cellAdj.push([]);
    for (let py2 = 0; py2 < PR; py2++) for (let px2 = 0; px2 < PC; px2++) {
      const c0 = frost[(py2 * PC + px2) * 4 + 3];
      if (px2 + 1 < PC) { const cr = frost[(py2 * PC + px2 + 1) * 4 + 3]; if (cr !== c0) { seen[c0][cr] = 1; seen[cr][c0] = 1; } }
      if (py2 + 1 < PR) { const cb = frost[((py2 + 1) * PC + px2) * 4 + 3]; if (cb !== c0) { seen[c0][cb] = 1; seen[cb][c0] = 1; } }
    }
    for (let c3 = 0; c3 < NCELLS; c3++) { const ks = Object.keys(seen[c3]); for (let ki = 0; ki < ks.length; ki++) cellAdj[c3].push(Number(ks[ki])); }
  }
  function enqueueGlintHops(cell: number, visited: Record<number, 1>, val: number, hops: number) {
    if (hops <= 0 || val < 0.12) return;
    const nb = cellAdj[cell]; if (!nb || !nb.length) return;
    const maxB = rnd(1) < 0.35 ? 2 : 1; let branches = 0;
    for (let i = 0; i < nb.length && branches < maxB; i++) {
      const nc = nb[(rnd(nb.length)) | 0]; if (visited[nc]) continue;
      visited[nc] = 1; branches++;
      glintQueue.push({ cell: nc, val, delay: 2 + (rnd(4) | 0), hops: hops - 1, visited });
    }
  }
  function startGlintChain() {
    const start = (rnd(NCELLS)) | 0, visited: Record<number, 1> = {}; visited[start] = 1;
    glints.push({ cell: start, val: 1 });
    enqueueGlintHops(start, visited, 0.85, 4 + (rnd(4) | 0));
  }
  function drawCold() {
    if (cold <= 0.005 || !frost) return;
    let gmap: Float32Array | null = null;
    if (glints.length) { gmap = new Float32Array(NCELLS); for (let gi = 0; gi < glints.length; gi++) { const gg = glints[gi]; if (gg.val > gmap[gg.cell]) gmap[gg.cell] = gg.val; } }
    for (let py = 0; py < PR; py++) for (let px = 0; px < PC; px++) {
      const idx = (py * PC + px) * 4, thr = frost[idx + 2] / 255;
      if (cold < thr) continue;
      const vein = frost[idx] / 255, bright = frost[idx + 1] / 255, x = PX0 + px, y = PY0 + py;
      put(x, y, 214, 236, 252, frostAlpha(bright, settle) | 0);
      if (vein > 0.04) put(x, y, 68, 148, 212, (vein * 118 * settle) | 0);
      const since = cold - thr; if (since < 0.14) { const fl = 1 - since / 0.14; put(x, y, 244, 252, 255, (fl * 145) | 0); }
      if (gmap) { const gv = gmap[frost[idx + 3]]; if (gv > 0.03) put(x, y, 250, 253, 255, (gv * (80 + bright * 70)) | 0); }
    }
  }
  function drawShardProj() {
    if (!proj) return;
    const ax = axX, ay = axY, nx = -ay, ny = ax, L = 13, halfL = L / 2, cx = proj.x, cy = proj.y, lit = proj.lit || 1;
    for (let li = -halfL; li <= halfL; li += 1) {
      const tt = (li + halfL) / L, prof = Math.sin(tt * Math.PI); let hw = 3.4 * Math.pow(prof, 0.62); if (hw < 0.5 && prof > 0.02) hw = 0.5;
      for (let s = -hw; s <= hw; s += 1) {
        const sn = s / (hw + 0.001), asn = Math.abs(sn); let col: [number, number, number];
        if (sn * lit > 0.1 && sn * lit < 0.55) col = ICE_HI;
        else if (asn < 0.28) col = ICE_CORE;
        else if (asn > 0.74) col = ICE_EDGE;
        else col = ICE_MID;
        put(cx + ax * li + nx * s, cy + ay * li + ny * s, col[0], col[1], col[2], 185);
      }
    }
  }
  function drawSnow() {
    for (let i = 0; i < snows.length; i++) {
      const f = snows[i], a = Math.min(1, f.life), x = f.x, y = f.y;
      put(x, y, 240, 250, 255, (a * 255) | 0);
      put(x - 1, y, 205, 235, 255, (a * 190) | 0); put(x + 1, y, 205, 235, 255, (a * 190) | 0); put(x, y - 1, 205, 235, 255, (a * 190) | 0); put(x, y + 1, 205, 235, 255, (a * 190) | 0);
      if (f.size > 1) {
        put(x - 2, y, 190, 225, 255, (a * 120) | 0); put(x + 2, y, 190, 225, 255, (a * 120) | 0); put(x, y - 2, 190, 225, 255, (a * 120) | 0); put(x, y + 2, 190, 225, 255, (a * 120) | 0);
        put(x - 1, y - 1, 195, 230, 255, (a * 110) | 0); put(x + 1, y + 1, 195, 230, 255, (a * 110) | 0); put(x - 1, y + 1, 195, 230, 255, (a * 110) | 0); put(x + 1, y - 1, 195, 230, 255, (a * 110) | 0);
      }
    }
  }
  function drawSpecks() { for (let i = 0; i < specks.length; i++) { const p = specks[i]; put(p.x, p.y, 220, 240, 255, (Math.min(1, p.life) * 200) | 0); } }

  function update() {
    if (state === "incoming" && proj) {
      const dx = CX - proj.x, dy = CY - proj.y, dist = Math.max(0.001, Math.hypot(dx, dy)), SPEED = Math.max(2.4, W / 42);
      if (dist <= SPEED) {
        proj = null; state = "cold"; pillarTimer = 6 + (rnd(10) | 0);
        spawnSnowBurst(CX, CY);
        for (let k = 0; k < 12; k++) { const a = rnd(6.283), sp = 0.5 + rnd(1.6); spawnSpeck(CX, CY, Math.cos(a) * sp, Math.sin(a) * sp, 1); }
      } else { proj.x += axX * SPEED; proj.y += axY * SPEED; }
    }
    if (state === "cold") {
      if (cold < 1.15) cold = Math.min(1.15, cold + 0.02);
      if (cold >= 1.05) {
        if (settle > 0.6) settle = Math.max(0.6, settle - 0.012);
        glintTimer--; if (glintTimer <= 0 && NCELLS > 0) { startGlintChain(); glintTimer = 26 + (rnd(52) | 0); }
        pillarTimer--; if (pillarTimer <= 0 && pillars.length < 12) { spawnCluster(); pillarTimer = 16 + (rnd(40) | 0); }
      }
      if (rnd(1) < 0.22) spawnSpeck(PX0 + rnd(PC), PY1, (rnd(1) - 0.5) * 0.2, -(0.05 + rnd(0.14)), 1);
    }
    for (let i = pillars.length - 1; i >= 0; i--) {
      const p = pillars[i];
      if (p.phase === "grow") { p.grow += 0.17; if (p.grow >= 1) { p.grow = 1; p.phase = "hold"; } }
      else {
        p.hold--;
        if (p.hold === GL_DUR) p.gl = GL_DUR;
        if (p.gl > 0) p.gl--;
        if (p.hold <= 0) { spawnShatter(p); pillars.splice(i, 1); }
      }
    }
    for (let fi = frags.length - 1; fi >= 0; fi--) { const fr = frags[fi]; fr.x += fr.vx; fr.y += fr.vy; fr.vy += 0.08; fr.vx *= 0.99; fr.life -= 0.03; if (fr.life <= 0) frags.splice(fi, 1); }
    for (let q = specks.length - 1; q >= 0; q--) { const s = specks[q]; s.x += s.vx + Math.sin(s.ph + t * 0.05) * 0.06; s.y += s.vy; s.life -= 0.018; if (s.life <= 0 || s.y < -2 || s.y > H + 2) specks.splice(q, 1); }
    for (let w = snows.length - 1; w >= 0; w--) { const sf = snows[w]; sf.x += sf.vx; sf.y += sf.vy; sf.vy += 0.05; sf.vx *= 0.97; sf.life -= 0.02; if (sf.life <= 0) snows.splice(w, 1); }
    for (let qi = glintQueue.length - 1; qi >= 0; qi--) { const q = glintQueue[qi]; q.delay--; if (q.delay <= 0) { glints.push({ cell: q.cell, val: q.val }); glintQueue.splice(qi, 1); enqueueGlintHops(q.cell, q.visited, q.val * 0.82, q.hops); } }
    for (let gj = glints.length - 1; gj >= 0; gj--) { glints[gj].val *= 0.88; if (glints[gj].val < 0.05) glints.splice(gj, 1); }
  }
  function draw() {
    clear();
    drawCold();
    drawSpecks();
    for (let i = 0; i < pillars.length; i++) drawPillar(pillars[i]);
    drawFrags();
    drawSnow();
    if (state === "incoming") drawShardProj();
    ctx.putImageData(img, 0, 0);
  }
  function frame(ts: number) { if (!last) last = ts; acc += ts - last; last = ts; while (acc >= 33) { t++; update(); acc -= 33; } draw(); raf = requestAnimationFrame(frame); }
  function runLoop() { if (raf == null) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
  function reset() { proj = null; snows = []; specks = []; pillars = []; frags = []; cold = 0; pillarTimer = 0; settle = 1; glints = []; glintQueue = []; glintTimer = 40; t = 0; buildFrost(); }

  return {
    canvas,
    start(ox?: number, oy?: number) {
      reset();
      // origin は枠相対 CSS px（0..PWpx/PHpx）で渡る＝マージン offset を足してグリッドへ変換。既定は枠の右上（術者位置）。
      const originX = ox == null ? PX1 - 2 : PX0 + (ox / PWpx) * PC;
      const originY = oy == null ? PY0 : PY0 + (oy / PHpx) * PR;
      const dx = CX - originX, dy = CY - originY, dd = Math.max(0.001, Math.hypot(dx, dy)); axX = dx / dd; axY = dy / dd;
      proj = { x: originX, y: originY, lit: rnd(1) < 0.5 ? 1 : -1 };
      state = "incoming"; draw(); runLoop();
    },
    startPersist() {
      // 履歴＝発射なしで全面凍結済み（霜は薄め）から持続。氷柱/ピカッは update が時間差で出す。
      reset();
      state = "cold"; cold = 1.15; settle = 0.7; pillarTimer = 8 + (rnd(20) | 0);
      draw(); runLoop();
    },
    resume() {
      if (raf == null && state !== "idle") { last = 0; acc = 0; raf = requestAnimationFrame(frame); }
    },
    reduceStatic() {
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
      reset();
      state = "static"; cold = 1.15; settle = 0.7;
      spawnCluster(); spawnCluster();
      for (let i = 0; i < pillars.length; i++) { pillars[i].grow = 1; pillars[i].phase = "hold"; }
      draw();
    },
    stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } },
  };
}
