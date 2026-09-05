// 雷エンジン（受入済みモック style-guide.html §17L-d の TS 移植・GF-AC-091）。
// 発動＝術者バッジ（右上）からビリビリ玉が飛来→パネル中央に着弾→ランダム方向へ雷1回→以降は永続で、
// ピカッと光るたびランダムな辺から連鎖(1〜2本)＋枠線ビリビリ＋着弾点で黄粒子。雲は無し。明色パネル向け（黄核＋暗紺縁）。
// production 化にあたり sparkle/fire と同じ追加＝(1) rng 注入（既定 Math.random）、(2) startPersist()（発射なしで稼働中から持続）、
// (3) resume()（画面外→再可視で state 保持のまま rAF 再開）。決定的部分（解像度/発雷フラッシュの水平減衰）は下部の純関数に分離（G-TC-157）。
import type { EngineOpts, SpellEngine } from "./index";

// ドット感を出す低解像度グリッドの1セル=約3px（炎と同契約）。
export const THUNDER_SCALE = 3;
// 発雷グローの水平減衰係数（中央の柱ほど明るい）。可読性優先で端は 0.35 まで落とす。
export const FLASH_FALLOFF = 0.65;

// 実寸(CSS px)→低解像度グリッド（cols×rows）。ドット絵の解像度を決める決定的関数。
export function thunderGrid(w: number, h: number, scale: number = THUNDER_SCALE): { cols: number; rows: number } {
  return {
    cols: Math.max(140, Math.round((w || 0) / scale)),
    rows: Math.max(20, Math.round((h || 0) / scale)),
  };
}

// 発雷でパネルをほんのり暖色に光らせる際の水平方向の明るさ係数（0..1）。中央 x=w/2 で 1、端ほど暗い。0 未満にならない。
export function flashBand(x: number, w: number): number {
  const cx = w / 2;
  const cxd = Math.abs(x - cx) / (w * 0.5 || 1);
  const band = 1 - cxd * FLASH_FALLOFF;
  return band < 0 ? 0 : band;
}

type Pt = [number, number];
type Bolt = { pts: Pt[]; branches: Pt[][]; life: number; delay: number; sparked: boolean };
type Crackle = { bx: number; by: number; ax: number; ay: number; px: number; py: number; len: number; dir: number; life: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number };

const CORE: [number, number, number] = [255, 225, 77]; // 黄核
const EDGE: [number, number, number] = [26, 38, 92];    // 暗紺の縁取り＝明色パネルで見える稲妻

export function createThunderEngine(opts: EngineOpts): SpellEngine {
  const PW = Math.max(80, opts.w || 320);
  const PH = Math.max(24, opts.h || 110);
  const rng = opts.rng ?? Math.random;
  const rnd = (n: number) => rng() * n;
  const { cols: W, rows: H } = thunderGrid(PW, PH);

  const canvas = document.createElement("canvas");
  canvas.className = "spell-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.style.imageRendering = "pixelated";
  canvas.style.filter = "drop-shadow(0 0 4px rgba(255,210,80,.45))"; // 黄グロー（明色パネルで浮く）
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(W, H);
  const D = img.data;

  let state: "idle" | "incoming" | "live" | "static" = "idle";
  let bolts: Bolt[] = [];
  let crackles: Crackle[] = [];
  let sparks: Spark[] = [];
  let proj: { x: number; y: number } | null = null;
  let flash = 0, strikeTimer = 0;
  let raf: number | null = null, last = 0, acc = 0;
  const CX = W >> 1, IMPACT_Y = (H * 0.5) | 0; // 着弾点＝パネル中央

  function clear() { for (let i = 0; i < D.length; i++) D[i] = 0; }
  function put(x: number, y: number, r: number, g: number, b: number, a: number) {
    x |= 0; y |= 0; a |= 0; if (a <= 0 || x < 0 || x >= W || y < 0 || y >= H) return;
    const o = (y * W + x) * 4; if (a >= D[o + 3]) { D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = a; }
  }
  // 任意2点間のジグザグ稲妻＋枝を1本ぶんのオブジェクトで返す。
  function makeBolt(x0: number, y0: number, x1: number, y1: number): Bolt {
    const pts: Pt[] = [], branches: Pt[][] = [];
    const dx = x1 - x0, dy = y1 - y0, dist = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.max(5, (dist / 2.4) | 0);
    const ux = dx / dist, uy = dy / dist, px = -uy, py = ux;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, bx = x0 + dx * t, by = y0 + dy * t;
      const off = (i === 0 || i === steps) ? 0 : (rnd(6) - 3);
      pts.push([bx + px * off, by + py * off]);
    }
    const nb = 2 + (rnd(3) | 0); // 枝分かれ＝稲妻が広がる
    for (let j = 0; j < nb; j++) {
      const ni = 1 + (rnd(Math.max(1, pts.length - 2)) | 0);
      let sx = pts[ni][0], sy = pts[ni][1];
      const br: Pt[] = [[sx, sy]], len = 3 + (rnd(5) | 0), bdir = rnd(1) < 0.5 ? -1 : 1;
      for (let k = 0; k < len; k++) { sx += ux * (1 + rnd(2)) + px * bdir * (1 + rnd(1.5)); sy += uy * (1 + rnd(2)) + py * bdir * (1 + rnd(1.5)); br.push([sx, sy]); }
      branches.push(br);
    }
    return { pts, branches, life: 1, delay: 0, sparked: false };
  }
  function edgeStart() { // ランダムな辺の上のランダムな点
    const e = rnd(4) | 0;
    if (e === 0) return { x: rnd(W), y: 0 };
    if (e === 1) return { x: rnd(W), y: H - 1 };
    if (e === 2) return { x: 0, y: rnd(H) };
    return { x: W - 1, y: rnd(H) };
  }
  function innerTarget() { return { x: W * (0.2 + rnd(0.6)), y: H * (0.2 + rnd(0.6)) }; } // パネル内のランダム着弾点
  // (x,y)を起点に、着弾点から次の雷が伸びて連鎖し、最後はどこかの辺で止まる。手前の段から順に出る(delay)。
  function chainFrom(x: number, y: number, baseDelay: number) {
    let cur = { x, y }; const hops = 2 + (rnd(3) | 0);
    for (let h = 0; h < hops; h++) {
      const last2 = h === hops - 1, nxt = last2 ? edgeStart() : innerTarget();
      const bo = makeBolt(cur.x, cur.y, nxt.x, nxt.y); bo.delay = baseDelay + h * 2; bolts.push(bo); cur = nxt;
    }
  }
  function strikeEvent() { // ピカッ＝ランダムな辺から連鎖(1本 or 同時2本)。永続の落雷
    flash = 1;
    const count = 1 + (rnd(1) < 0.4 ? 1 : 0);
    for (let i = 0; i < count; i++) { const s = edgeStart(); chainFrom(s.x, s.y, 0); }
    strikeTimer = 42 + (rnd(96) | 0); // 次のピカッまで＝約1.4〜4.6秒
  }
  function drawPath(pts: Pt[], bright: number) { // 黄核＋暗紺縁取り
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) || 1;
      for (let s = 0; s <= steps; s++) {
        const tx = a[0] + (b[0] - a[0]) * s / steps, ty = a[1] + (b[1] - a[1]) * s / steps;
        put(tx - 1, ty, EDGE[0], EDGE[1], EDGE[2], 185 * bright); put(tx, ty - 1, EDGE[0], EDGE[1], EDGE[2], 155 * bright);
        put(tx, ty, CORE[0], CORE[1], CORE[2], 255 * bright);
      }
    }
  }
  function spawnCrackle() { // 枠線のランダムな位置に、辺に沿って走る短い電気（ビリビリ）
    const e = rnd(4) | 0; let bx = 0, by = 0, ax = 0, ay = 0, px = 0, py = 0;
    if (e === 0) { bx = rnd(W); by = 0; ax = 1; ay = 0; px = 0; py = 1; }
    else if (e === 1) { bx = rnd(W); by = H - 1; ax = 1; ay = 0; px = 0; py = -1; }
    else if (e === 2) { bx = 0; by = rnd(H); ax = 0; ay = 1; px = 1; py = 0; }
    else { bx = W - 1; by = rnd(H); ax = 0; ay = 1; px = -1; py = 0; }
    crackles.push({ bx, by, ax, ay, px, py, len: 7 + rnd(13), dir: rnd(1) < 0.5 ? -1 : 1, life: 1 });
  }
  function cracklePts(c: Crackle): Pt[] { // 毎フレーム再生成＝ビリビリ揺れる
    const n = Math.max(3, (c.len / 3) | 0), pts: Pt[] = [];
    for (let i = 0; i <= n; i++) { const t = i / n, along = t * c.len * c.dir, perp = i === 0 ? 0 : (rnd(3.4) - 1.7); pts.push([c.bx + c.ax * along + c.px * perp, c.by + c.ay * along + c.py * perp]); }
    return pts;
  }
  function drawCrackles() { for (let i = 0; i < crackles.length; i++) drawPath(cracklePts(crackles[i]), Math.min(1, crackles[i].life) * 0.8); }
  function spawnSparks(x: number, y: number) { // 着弾点から四方へ黄色い粒子
    const n = 8 + (rnd(6) | 0);
    for (let i = 0; i < n; i++) { const a = rnd(6.283), sp = 0.6 + rnd(2.4); sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.3, life: 1 }); }
  }
  function drawSparks() {
    for (let i = 0; i < sparks.length; i++) {
      const p = sparks[i], a = Math.min(1, p.life);
      put(p.x, p.y + 1, EDGE[0], EDGE[1], EDGE[2], (a * 80) | 0);
      put(p.x, p.y, 255, 214, 60, (a * 255) | 0); put(p.x + 1, p.y, 255, 232, 120, (a * 150) | 0);
    }
  }
  function drawDisk(cx: number, cy: number, r: number, cr: number, cg: number, cb: number, a: number) {
    const ri = Math.ceil(r); for (let yy = -ri; yy <= ri; yy++) for (let xx = -ri; xx <= ri; xx++) if (xx * xx + yy * yy <= r * r) put(cx + xx, cy + yy, cr, cg, cb, a);
  }
  function drawProj() { // 発動のビリビリ玉＝白熱の芯＋琥珀グロー＋周囲に短いジグザグ電気（毎フレーム変わる）
    if (!proj) return; const x = proj.x, y = proj.y;
    drawDisk(x, y, 4, 255, 170, 40, 120); drawDisk(x, y, 2.4, 255, 220, 80, 255); put(x, y, 255, 255, 255, 255);
    for (let k = 0; k < 3; k++) {
      const ang = rnd(6.283), L = 4 + rnd(4), n = 3, pts: Pt[] = [[x, y]];
      for (let i = 1; i <= n; i++) { const t = i / n; pts.push([x + Math.cos(ang) * L * t + (rnd(3) - 1.5), y + Math.sin(ang) * L * t + (rnd(3) - 1.5)]); }
      drawPath(pts, 0.8);
    }
  }
  function update() {
    if (state === "incoming" && proj) { // ビリビリ玉が術者バッジ→中央へ。着弾でランダム方向へ雷1回→永続へ
      const dx = CX - proj.x, dy = IMPACT_Y - proj.y, dist = Math.max(0.001, Math.hypot(dx, dy)), SPEED = Math.max(2.5, W / 55);
      if (dist <= SPEED) {
        proj = null; const tg = edgeStart(); bolts.push(makeBolt(CX, IMPACT_Y, tg.x, tg.y)); spawnSparks(CX, IMPACT_Y); flash = 1;
        state = "live"; strikeTimer = 48 + (rnd(60) | 0);
      } else { proj.x += dx / dist * SPEED; proj.y += dy / dist * SPEED; }
    }
    if (state === "live") { strikeTimer--; if (strikeTimer <= 0) strikeEvent(); }
    flash *= 0.9;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; if (b.delay > 0) { b.delay--; continue; }
      if (!b.sparked) { const ep = b.pts[b.pts.length - 1]; spawnSparks(ep[0], ep[1]); b.sparked = true; }
      b.life *= 0.72; if (b.life <= 0.05) bolts.splice(i, 1);
    }
    for (let q = sparks.length - 1; q >= 0; q--) { const sp = sparks[q]; sp.x += sp.vx; sp.y += sp.vy; sp.vy += 0.08; sp.vx *= 0.96; sp.life -= 0.05; if (sp.life <= 0) sparks.splice(q, 1); }
    if (state === "live" && crackles.length < 4 && rnd(1) < 0.2) spawnCrackle();
    for (let m = crackles.length - 1; m >= 0; m--) { crackles[m].life -= 0.11; if (crackles[m].life <= 0) crackles.splice(m, 1); }
  }
  function draw() {
    clear();
    if (flash > 0.03) { // 発雷でパネルがほんのり暖色(琥珀)に＝可読性優先で薄め・中央の柱ほど明るい
      const gl = Math.min(1, flash);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const band = flashBand(x, W);
        put(x, y, 255, 150 + ((band * 45) | 0), 36, (gl * band * 42) | 0);
      }
    }
    drawCrackles();
    for (let i = 0; i < bolts.length; i++) {
      const bo = bolts[i]; if (bo.delay > 0) continue; const bright = Math.min(1, bo.life + 0.35);
      drawPath(bo.pts, bright); for (let j = 0; j < bo.branches.length; j++) drawPath(bo.branches[j], bright * 0.85);
    }
    drawSparks();
    if (state === "incoming") drawProj();
    ctx.putImageData(img, 0, 0);
  }
  function frame(ts: number) { if (!last) last = ts; acc += ts - last; last = ts; while (acc >= 33) { update(); acc -= 33; } draw(); raf = requestAnimationFrame(frame); }
  function runLoop() { if (raf == null) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
  function reset() { bolts = []; crackles = []; sparks = []; proj = null; flash = 0; strikeTimer = 0; }

  return {
    canvas,
    start(ox?: number, oy?: number) {
      reset();
      // origin は size.w/size.h(CSS px)で渡る＝低解像度グリッドへ変換。既定は枠の右上（術者位置）。
      const gx = ox == null ? W - 3 : (ox / PW) * W;
      const gy = oy == null ? 0 : (oy / PH) * H;
      state = "incoming"; proj = { x: gx, y: gy };
      draw(); runLoop();
    },
    startPersist() {
      // 履歴＝発射なしで「稼働中の永続雷」から。すぐ光るよう軽く仕込む。
      reset();
      state = "live"; spawnCrackle(); spawnCrackle(); strikeTimer = 18 + (rnd(24) | 0);
      draw(); runLoop();
    },
    resume() {
      if (raf == null && state !== "idle") { last = 0; acc = 0; raf = requestAnimationFrame(frame); }
    },
    reduceStatic() {
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
      reset();
      state = "static";
      bolts.push(makeBolt(W - 3, 0, CX, IMPACT_Y)); spawnSparks(CX, IMPACT_Y);
      for (let s = 0; s < sparks.length; s++) { sparks[s].x += sparks[s].vx * 3; sparks[s].y += sparks[s].vy * 3; sparks[s].life = 0.8; }
      spawnCrackle(); spawnCrackle(); flash = 0.5; draw();
    },
    stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } },
  };
}
