// 炎エンジン（受入済みモック style-guide.html §17L-b の TS 移植・GF-AC-091）。
// 術者から火の玉が飛来→中央下部に着弾して着火→左右へ延焼（明色パネル向けドット絵）。
// production 化にあたり sparkle と同じ追加＝(1) rng 注入（既定 Math.random）、(2) startPersist()（発射なし＝延焼済みで持続）、
// (3) resume()（画面外→再可視で state 保持のまま rAF 再開）。決定的部分（解像度/可読性フェード）は下部の純関数として分離（G-TC-156）。
import type { EngineOpts, SpellEngine } from "./index";

// ドット感を出す低解像度グリッドの1セル=約3px。
export const FIRE_SCALE = 3;
// 可読性フェード＝根元(下辺)は不透明、上端ほど透過（重なった文字が透けて読める）。
export const FIRE_FADE_SOLID = 3, FIRE_FADE_SPAN = 8, FIRE_FADE_MIN = 0.28;

// 実寸(CSS px)→低解像度グリッド（cols×rows）。ドット絵の解像度を決める決定的関数。
export function fireGrid(w: number, h: number, scale: number = FIRE_SCALE): { cols: number; rows: number } {
  return {
    cols: Math.max(140, Math.round((w || 0) / scale)),
    rows: Math.max(20, Math.round((h || 0) / scale)),
  };
}

// 下辺から数えた高さ above（行）に対する不透明度係数（0..1）。根元は 1、上端ほど FIRE_FADE_MIN まで落ちる。
export function fireFade(above: number): number {
  if (above <= FIRE_FADE_SOLID) return 1;
  return Math.max(FIRE_FADE_MIN, 1 - (above - FIRE_FADE_SOLID) / FIRE_FADE_SPAN);
}

type Smoke = { x: number; y: number; vx: number; vy: number; life: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number };

// 明色パネル向けの炎パレット（0=透過→深赤→橙→黄→白熱）。[r,g,b,a]。
const PAL: [number, number, number, number][] = [
  [0, 0, 0, 0], [40, 12, 8, 150], [90, 20, 10, 205], [140, 28, 12, 235], [190, 44, 14, 250],
  [225, 80, 16, 255], [244, 120, 22, 255], [250, 160, 34, 255], [253, 196, 64, 255], [255, 224, 120, 255], [255, 246, 205, 255],
];
const MAXH = PAL.length - 1;

export function createFireEngine(opts: EngineOpts): SpellEngine {
  const PW = Math.max(80, opts.w || 320);
  const PH = Math.max(24, opts.h || 110);
  const rng = opts.rng ?? Math.random;
  const rnd = (n: number) => rng() * n;
  const { cols: W, rows: H } = fireGrid(PW, PH);

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
  canvas.style.filter = "drop-shadow(0 0 5px rgba(234,88,12,.5))"; // 暖色ハロー（明色パネルで浮く）
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(W, H);

  const heat = new Uint8Array(W * H);
  let smoke: Smoke[] = [];
  let sparks: Spark[] = [];
  let state: "idle" | "incoming" | "lit" = "idle";
  let proj: { x: number; y: number } | null = null;
  let raf: number | null = null;
  let last = 0, acc = 0;
  const CX = W >> 1;
  let frontL = CX, frontR = CX, lit0 = false;
  const FRONT_SPEED = (W / 2) / 60;

  function putPix(d: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, a: number) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const o = (y * W + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
  }
  function spreadFire(y: number, x: number) {
    const src = y * W + x, pix = heat[src], ny = y - 1;
    if (pix === 0) { heat[ny * W + x] = 0; return; }
    const r = (rng() * 3) | 0; let nx = x + (1 - r);
    if (nx < 0) nx = 0; else if (nx >= W) nx = W - 1;
    const cool = rng() < 0.88 ? 1 : 0;
    heat[ny * W + nx] = Math.max(0, pix - cool);
  }
  function seedRow() {
    if (!lit0) return;
    const by = H - 1, xL = frontL < 0 ? 0 : frontL | 0, xR = frontR >= W ? W - 1 : frontR | 0;
    for (let x = xL; x <= xR; x++) { heat[by * W + x] = MAXH; heat[(by - 1) * W + x] = MAXH; }
    for (let k = 0; k < 6; k++) {
      const fxl = xL + k, fxr = xR - k;
      if (fxl >= 0 && fxl < W) heat[(by - 2) * W + fxl] = MAXH;
      if (fxr >= 0 && fxr < W) heat[(by - 2) * W + fxr] = MAXH;
    }
  }
  function step() { seedRow(); for (let x = 0; x < W; x++) for (let y = 1; y < H; y++) spreadFire(y, x); }
  function topFlameYAt(x: number) { for (let y = 0; y < H; y++) if (heat[y * W + x] > 3) return y; return H - 3; }
  function updateSmoke() {
    if (state === "lit" && lit0) {
      const xL = frontL < 0 ? 0 : frontL | 0, xR = frontR >= W ? W - 1 : frontR | 0;
      if (rng() < 0.45 && xL <= xR) {
        const sx = (xL + rnd(xR - xL + 1)) | 0;
        smoke.push({ x: sx, y: topFlameYAt(sx), vx: (rnd(2) - 1) * 0.12, vy: -(0.3 + rnd(0.3)), life: 1 });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i]; p.x += p.vx; p.y += p.vy; p.vx += (rnd(2) - 1) * 0.03; p.life -= 0.02;
      if (p.life <= 0 || p.y < -2) smoke.splice(i, 1);
    }
  }
  function drawProjectile(d: Uint8ClampedArray) {
    if (!proj) return;
    const px = proj.x, py = proj.y;
    const vx = CX - px, vy = (H - 3) - py, len = Math.sqrt(vx * vx + vy * vy) || 1, ux = vx / len, uy = vy / len;
    for (let t = 1; t <= 7; t++) {
      const txp = px - ux * t, typ = py - uy * t, a = 255 * (1 - t / 8);
      putPix(d, txp | 0, typ | 0, 255, 140, 40, a | 0); putPix(d, txp | 0, (typ | 0) - 1, 235, 90, 20, (a * 0.55) | 0);
    }
    for (let yy = -4; yy <= 4; yy++) for (let xx = -4; xx <= 4; xx++) {
      const r = Math.sqrt(xx * xx + yy * yy); if (r > 3.6) continue;
      const col = r < 1.2 ? [255, 246, 210] : r < 2.4 ? [255, 210, 90] : [255, 150, 50];
      putPix(d, (px | 0) + xx, (py | 0) + yy, col[0], col[1], col[2], 255);
    }
    putPix(d, px | 0, py | 0, 255, 255, 235, 255);
  }
  function render() {
    const d = img.data;
    for (let i = 0; i < d.length; i++) d[i] = 0;
    for (let y = 0; y < H; y++) {
      const above = H - 1 - y, fade = fireFade(above);
      for (let x = 0; x < W; x++) {
        const h = heat[y * W + x];
        if (h > 0) { const c = PAL[h], o = (y * W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = (c[3] * fade) | 0; }
      }
    }
    if (state === "incoming" && proj) drawProjectile(d);
    for (let i = 0; i < smoke.length; i++) {
      const p = smoke[i], a = (p.life * 0.72 * 255) | 0;
      putPix(d, p.x | 0, p.y | 0, 48, 46, 52, a); putPix(d, (p.x | 0) + 1, p.y | 0, 40, 38, 44, (p.life * 0.55 * 255) | 0);
    }
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i], sa = (s.life * 255) | 0, hot = s.life > 0.5;
      putPix(d, s.x | 0, s.y | 0, 255, hot ? 235 : 150, hot ? 170 : 40, sa);
    }
    ctx.putImageData(img, 0, 0);
  }
  function burstSparks(ox: number, oy: number) {
    for (let i = 0; i < 22; i++) {
      const ang = -Math.PI + rnd(Math.PI), sp = 0.9 + rnd(2.2);
      sparks.push({ x: ox, y: oy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.4, life: 1 });
    }
  }
  function updateSparks() {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.x += s.vx; s.y += s.vy; s.vy += 0.14; s.vx *= 0.98; s.life -= 0.035;
      if (s.life <= 0 || s.y >= H) sparks.splice(i, 1);
    }
  }
  function ignite() {
    let ix = proj ? proj.x | 0 : CX; if (ix < 2) ix = 2; else if (ix > W - 3) ix = W - 3;
    const iy = proj ? proj.y | 0 : H - 4;
    state = "lit"; lit0 = true; frontL = ix - 2; frontR = ix + 2;
    for (let x = frontL; x <= frontR; x++) for (let y = H - 6; y < H; y++) if (x >= 0 && x < W && y >= 0) heat[y * W + x] = MAXH;
    burstSparks(ix, iy);
  }
  function reset() { heat.fill(0); smoke = []; sparks = []; lit0 = false; proj = null; frontL = CX; frontR = CX; }
  function frame(ts: number) {
    if (!last) last = ts;
    acc += ts - last; last = ts;
    if (state === "incoming" && proj) {
      const dx = CX - proj.x, dy = (H - 3) - proj.y, dist = Math.sqrt(dx * dx + dy * dy), SPEED = Math.max(2.5, W / 80);
      if (dist <= SPEED) { proj.x = CX; proj.y = H - 3; ignite(); }
      else { proj.x += (dx / dist) * SPEED; proj.y += (dy / dist) * SPEED; }
    }
    if (state === "lit") {
      if (frontL > 0) { frontL -= FRONT_SPEED; if (frontL < 0) frontL = 0; }
      if (frontR < W - 1) { frontR += FRONT_SPEED; if (frontR > W - 1) frontR = W - 1; }
    }
    while (acc >= 33) { if (state === "lit") step(); updateSmoke(); updateSparks(); acc -= 33; }
    render();
    raf = requestAnimationFrame(frame);
  }
  function runLoop() { if (raf == null) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }

  return {
    canvas,
    start(ox?: number, oy?: number) {
      reset();
      state = "incoming";
      // origin は size.w/size.h(CSS px)で渡る＝低解像度グリッドへ変換。
      const gx = ox == null ? W - 3 : (ox / PW) * W;
      const gy = oy == null ? 0 : (oy / PH) * H;
      proj = { x: gx, y: gy };
      render(); runLoop();
    },
    startPersist() {
      // 履歴＝発射なしで延焼済み（全幅が燃えている）状態から持続。
      reset();
      state = "lit"; lit0 = true; frontL = 0; frontR = W - 1;
      for (let k = 0; k < 20; k++) step();
      render(); runLoop();
    },
    resume() {
      if (raf == null && state !== "idle") { last = 0; acc = 0; raf = requestAnimationFrame(frame); }
    },
    reduceStatic() {
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
      reset();
      state = "lit"; lit0 = true; frontL = 0; frontR = W - 1;
      for (let k = 0; k < 60; k++) step();
      render();
    },
    stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } },
  };
}
