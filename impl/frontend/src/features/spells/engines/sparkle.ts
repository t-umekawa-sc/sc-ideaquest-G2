// キラキラエンジン（受入済みモック style-guide.html §17h の TS 移植・GF-AC-091）。
// 流れ星→中央着弾でキラキラが四方へ弾け→まばらに瞬き続ける（背景に天の川＋オーロラ＋たまにドット絵UFO）。
// production 化にあたり追加＝(1) rng 注入（既定 Math.random）、(2) startPersist()（発射なし永続）、
// (3) resume()（画面外→再可視で state 保持のまま rAF 再開）。決定的部分は sprites.ts（G-TC-155）へ分離。
import { decodeSprite, ufoPosition, UFO_ART, UFO_COL, type UfoParams } from "./sprites";
import type { EngineOpts, SpellEngine } from "./index";

type Star = { x: number; y: number; trail: [number, number][] };
type BurstP = { x: number; y: number; vx: number; vy: number; life: number; size: number; col: string };
type Twinkle = { x: number; y: number; vx: number; vy: number; age: number; dur: number; size: number; col: string };
type MwStar = { x: number; y: number; b: number; ph: number; sz: number };
type Ufo = UfoParams & { pat: number; dir: number; spd: number; prog: number; hover: number; x: number; y: number };

const COLS = ["255,255,255", "255,233,168", "255,200,230", "216,240,255", "255,240,192"];
// オーロラ色（緑→シアン→紫→桃で巡回）。
const AUR: [number, number, number][] = [[80, 255, 175], [70, 215, 255], [180, 130, 255], [255, 150, 220]];
const UFO_CELLS = decodeSprite(UFO_ART, UFO_COL);
const UFO_W = 15, UFO_H = 8, UFO_PX = 2.4;

export function createSparkleEngine(opts: EngineOpts): SpellEngine {
  const W = Math.max(80, opts.w || 320);
  const H = Math.max(24, opts.h || 110);
  const dpr = opts.dpr || 1;
  const rng = opts.rng ?? Math.random;
  const rnd = (n: number) => rng() * n;
  const pick = () => COLS[rnd(COLS.length) | 0];

  const canvas = document.createElement("canvas");
  canvas.className = "spell-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const CX = W / 2, CY = H / 2;
  let state: "idle" | "incoming" | "persist" = "idle";
  let raf: number | null = null;
  let last = 0, acc = 0, t = 0;
  let star: Star | null = null;
  let burst: BurstP[] = [];
  let twinkles: Twinkle[] = [];
  let mwStars: MwStar[] = [];
  let bgFade = 0;
  let ufo: Ufo | null = null;
  let ufoTimer = 300 + (rnd(300) | 0);

  function buildMilkyWay() {
    mwStars = [];
    const n = Math.max(90, (W / 7) | 0);
    for (let i = 0; i < n; i++) {
      const u = rnd(1), lx = u * W, ly = H * 0.18 + u * (H * 0.62);
      const off = ((rnd(1) + rnd(1) + rnd(1)) - 1.5) / 1.5 * H * 0.34;
      mwStars.push({ x: lx, y: ly + off, b: 0.15 + rnd(0.6), ph: rnd(6.28), sz: 0.5 + rnd(1.1) });
    }
  }
  function auroraCol(ph: number): [number, number, number] {
    const f = (((ph % 1) + 1) % 1) * AUR.length, i = Math.floor(f), fr = f - i;
    const a = AUR[i], b = AUR[(i + 1) % AUR.length];
    return [(a[0] + (b[0] - a[0]) * fr) | 0, (a[1] + (b[1] - a[1]) * fr) | 0, (a[2] + (b[2] - a[2]) * fr) | 0];
  }
  function drawAurora() {
    const fade = bgFade;
    for (let x = 0; x < W; x += 4) {
      const wave = Math.sin(x * 0.022 + t * 0.03) * 12 + Math.sin(x * 0.06 + t * 0.052) * 7;
      let hh = H * 0.5 + wave; if (hh < 8) hh = 8;
      const c = auroraCol(x * 0.0018 + t * 0.004);
      const g = ctx.createLinearGradient(0, 0, 0, hh);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${(0.26 * fade).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${(0.12 * fade).toFixed(3)})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g; ctx.fillRect(x, 0, 4, hh);
    }
  }
  function drawMilkyWay() {
    const fade = bgFade;
    for (let k = 0; k <= 9; k++) {
      const u = k / 9, hx = u * W, hy = H * 0.18 + u * (H * 0.62);
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, H * 0.5);
      g.addColorStop(0, `rgba(196,204,240,${(0.05 * fade).toFixed(3)})`);
      g.addColorStop(1, "rgba(196,204,240,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, H * 0.5, 0, 6.2832); ctx.fill();
    }
    ctx.fillStyle = "rgba(224,232,255,1)";
    for (let k = 0; k < mwStars.length; k++) {
      const s = mwStars[k], a = s.b * (0.5 + 0.5 * Math.sin(t * 0.06 + s.ph)) * fade;
      if (a <= 0.02) continue;
      ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(s.x, s.y, s.sz, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawGlint(x: number, y: number, size: number, alpha: number, col: string) {
    if (alpha <= 0.02) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 1.4);
    g.addColorStop(0, `rgba(${col},${(alpha * 0.9).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(${col},${(alpha * 0.22).toFixed(3)})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, size * 1.4, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`; ctx.lineCap = "round";
    ctx.lineWidth = Math.max(0.8, size * 0.14);
    ctx.beginPath(); ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size); ctx.stroke();
    ctx.lineWidth = Math.max(0.6, size * 0.09); ctx.strokeStyle = `rgba(255,255,255,${(alpha * 0.55).toFixed(3)})`;
    const d = size * 0.5;
    ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x - d, y + d); ctx.lineTo(x + d, y - d); ctx.stroke();
  }
  function drawStar() {
    if (!star) return;
    const tr = star.trail;
    for (let i = 0; i < tr.length - 1; i++) {
      const a = tr[i], b = tr[i + 1], al = (i / tr.length) * 0.85;
      ctx.globalAlpha = al; ctx.strokeStyle = "rgba(255,246,210,1)"; ctx.lineCap = "round"; ctx.lineWidth = 0.8 + (i / tr.length) * 3.2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawGlint(star.x, star.y, 7, 1, "255,246,210");
  }
  function spawnUFO() {
    const pat = rnd(10) | 0, dir = rng() < 0.5 ? 1 : -1;
    ufo = {
      pat, dir, x0: dir > 0 ? -30 : W + 30, x1: dir > 0 ? W + 30 : -30,
      yBase: H * 0.12 + rnd(H * 0.42), amp: H * 0.1 + rnd(H * 0.12), freq: 2 + (rnd(4) | 0),
      spd: 0.013 + rnd(0.008), prog: 0, hover: 0, x: 0, y: 0, H,
    };
    computeUFO();
    ufoTimer = 420 + (rnd(600) | 0);
  }
  function computeUFO() {
    if (!ufo) return;
    const pos = ufoPosition(ufo.pat, ufo.prog, ufo);
    ufo.x = pos.x; ufo.y = pos.y;
  }
  function updateUFO() {
    if (ufo) {
      const u = ufo;
      if (u.pat === 8) { if (u.prog > 0.42 && u.prog < 0.5 && u.hover < 14) u.hover++; else u.prog += u.spd; }
      else if (u.pat === 9) u.prog += u.spd * (0.35 + u.prog * 1.7);
      else u.prog += u.spd;
      computeUFO();
      if (u.prog >= 1) ufo = null;
    } else if (state === "persist") { ufoTimer--; if (ufoTimer <= 0) spawnUFO(); }
  }
  function drawUFO() {
    if (!ufo) return;
    const x = ufo.x, y = ufo.y + Math.sin(t * 0.14) * 1.5;
    const bg = ctx.createRadialGradient(x, y + 9, 0, x, y + 9, 20);
    bg.addColorStop(0, `rgba(120,240,220,${(0.2 * bgFade).toFixed(2)})`);
    bg.addColorStop(1, "rgba(120,240,220,0)");
    ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(x, y + 9, 20, 11, 0, 0, 6.2832); ctx.fill();
    const px = UFO_PX, ox = x - (UFO_W * px) / 2, oy = y - (UFO_H * px) / 2;
    for (const cell of UFO_CELLS) {
      const col = cell.char === "L" ? (Math.sin(t * 0.4 + cell.x) > 0 ? "#ffe14d" : "#40e0ff") : cell.color!;
      const x0 = Math.round(ox + cell.x * px), x1 = Math.round(ox + (cell.x + 1) * px);
      const y0 = Math.round(oy + cell.y * px), y1 = Math.round(oy + (cell.y + 1) * px);
      ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  function spawnBurst(x: number, y: number) {
    for (let i = 0; i < 20; i++) {
      const ang = rnd(6.283), sp = 1.4 + rnd(3.6);
      burst.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, size: 2 + rnd(3), col: pick() });
    }
  }
  function updateBurst() {
    for (let i = burst.length - 1; i >= 0; i--) {
      const p = burst[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93; p.life -= 0.028;
      if (p.life <= 0) burst.splice(i, 1);
    }
  }
  function spawnTwinkle() {
    twinkles.push({ x: rnd(W), y: rnd(H), vx: (rnd(2) - 1) * 0.1, vy: (rnd(2) - 1) * 0.08 - 0.03, age: 0, dur: 28 + (rnd(44) | 0), size: 1.6 + rnd(2.6), col: pick() });
  }
  function updateTwinkles() {
    for (let i = twinkles.length - 1; i >= 0; i--) {
      const w = twinkles[i]; w.age++; w.x += w.vx; w.y += w.vy;
      if (w.age >= w.dur) twinkles.splice(i, 1);
    }
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    if (bgFade > 0.01) { drawAurora(); drawMilkyWay(); }
    drawUFO();
    for (let i = 0; i < twinkles.length; i++) { const w = twinkles[i], a = Math.sin((w.age / w.dur) * 3.14159); drawGlint(w.x, w.y, w.size, a * 0.95, w.col); }
    for (let i = 0; i < burst.length; i++) { const p = burst[i]; drawGlint(p.x, p.y, p.size * (0.6 + p.life * 0.7), p.life, p.col); }
    if (state === "incoming" && star) drawStar();
  }
  function frame(ts: number) {
    if (!last) last = ts;
    acc += ts - last; last = ts;
    if (state === "incoming" && star) {
      const dx = CX - star.x, dy = CY - star.y, dist = Math.sqrt(dx * dx + dy * dy), SPEED = Math.max(6, (W + H) / 70);
      if (dist <= SPEED) { spawnBurst(CX, CY); star = null; state = "persist"; }
      else {
        star.x += (dx / dist) * SPEED; star.y += (dy / dist) * SPEED;
        star.trail.push([star.x, star.y]); if (star.trail.length > 10) star.trail.shift();
      }
    }
    while (acc >= 33) {
      t++;
      if (state === "persist" && bgFade < 1) bgFade = Math.min(1, bgFade + 0.02);
      updateBurst();
      if (state === "persist" && rng() < 0.2) spawnTwinkle();
      updateTwinkles();
      updateUFO();
      acc -= 33;
    }
    render();
    raf = requestAnimationFrame(frame);
  }
  function runLoop() { if (raf == null) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
  function reset() {
    star = null; burst = []; twinkles = []; bgFade = 0; ufo = null; ufoTimer = 300 + (rnd(300) | 0); t = 0;
    buildMilkyWay();
  }

  return {
    canvas,
    start(ox?: number, oy?: number) {
      reset();
      const sx = ox == null ? W - 6 : ox, sy = oy == null ? 4 : oy;
      state = "incoming";
      star = { x: sx, y: sy, trail: [[sx, sy]] };
      render(); runLoop();
    },
    startPersist() {
      reset();
      state = "persist";
      render(); runLoop();
    },
    resume() {
      if (raf == null && state !== "idle") { last = 0; acc = 0; raf = requestAnimationFrame(frame); }
    },
    reduceStatic() {
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
      reset();
      state = "persist"; bgFade = 1;
      for (let k = 0; k < 12; k++) twinkles.push({ x: rnd(W), y: rnd(H), vx: 0, vy: 0, age: 14 + (rnd(30) | 0), dur: 60, size: 1.6 + rnd(2.6), col: pick() });
      render();
    },
    stop() {
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
    },
  };
}
