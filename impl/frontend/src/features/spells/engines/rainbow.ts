// 虹エンジン（受入済みモック style-guide.html §17L-f2「放浪バリエーション」の TS 移植・GF-AC-091）。
// 発動＝術者バッジから虹色ビームを発射→パネル中央に着弾→虹粒子がパネル全体へ満遍なく飛散→飛散粒子の1つの
// 位置へゆらゆら揺れながらゆっくり集結（早い粒子/遅い粒子＋開始ディレイのむら）→集まった数に比例してエネルギー球が
// 高まり溜まりきると球から中央へ再ビーム→繰り返す（囲む虹は描かない放浪型）。
// production 化＝(1) rng 注入、(2) startPersist()（発射なしで放浪サイクル途中から持続）、(3) resume()（state 保持で rAF 再開）。
// ※虹はフル解像度（ImageData グリッドではなく ctx 直描画＝滑らか）。canvas はパネルより一回り大きく（MARGIN）＋
//   負オフセットで張り出し、粒子/ビームが枠を少しはみ出せる。起点は枠相対 CSS px（useSpellEngine がコンテナ矩形
//   基準で算出）にマージン offset を足して canvas 座標へ変換する。決定的部分（散布ターゲット/チャージ量）は下部の純関数に分離（G-TC-159）。
import type { EngineOpts, SpellEngine } from "./index";

export const RAINBOW_MARGIN_PX = 30; // canvas をパネルより張り出す量（CSS px・モック §17L-f2 と同値）
export const RAINBOW_PALETTE = ["#ff5a5a", "#ff9f40", "#ffe14d", "#5fd06a", "#4aa0ff", "#b478ff"] as const;

// 着弾で虹粒子が飛ぶ先＝パネル内（パッド内）の一様ランダム座標（同心円にならず満遍なく散る）。決定的（rng 注入）。
export function rainbowScatterTargets(
  w: number, h: number, pad: number, n: number, rng: () => number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const spanX = Math.max(0, w - 2 * pad), spanY = Math.max(0, h - 2 * pad);
  for (let i = 0; i < n; i++) out.push({ x: pad + rng() * spanX, y: pad + rng() * spanY });
  return out;
}

// 集結点で溜まるエネルギー球の基準サイズ＝集まった粒子数 n に比例（単調非減少・0 以上）。可読性のため下限は控えめ。
export function rainbowChargeGrow(n: number): number {
  return n <= 0 ? 0 : 4 + n * 0.95;
}

type Part = { x: number; y: number; vx: number; vy: number; life: number; r: number; col: string; ph: number; pv: number; amp: number; ease: number; startDelay: number };
type Pt = { x: number; y: number };

export function createRainbowEngine(opts: EngineOpts): SpellEngine {
  const PWpx = Math.max(80, opts.w || 320);
  const PHpx = Math.max(24, opts.h || 110);
  const M = RAINBOW_MARGIN_PX;
  const dpr = opts.dpr || 1;
  const rng = opts.rng ?? Math.random;
  const rnd = (n: number) => rng() * n;
  const W = PWpx + 2 * M, H = PHpx + 2 * M;
  const CX = W / 2, CY = H / 2, PAD = M * 0.7; // 集結点/着弾/散布はこのパッド内に収める

  const canvas = document.createElement("canvas");
  canvas.className = "spell-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // canvas をパネルより一回り大きく張り出す（負オフセット）＝粒子/ビームが枠外へ少しはみ出せる。
  canvas.style.width = `calc(100% + ${2 * M}px)`;
  canvas.style.height = `calc(100% + ${2 * M}px)`;
  canvas.style.top = `-${M}px`;
  canvas.style.left = `-${M}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.style.filter = "drop-shadow(0 0 4px rgba(255,255,255,.55))"; // 明色パネルで虹が浮くソフトグロー
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const R = RAINBOW_PALETTE;
  let state: "idle" | "beam" | "scatter" | "gather" | "charge" | "static" = "idle";
  let raf: number | null = null, last = 0, acc = 0;
  let origin: Pt = { x: W - 6, y: M }, target: Pt = { x: CX, y: CY };
  let beamProg = 0, beamFade = 0;
  const BEAM_SPEED = 0.09; // 33ms 固定ステップでの進行（≈0.36s で着弾）
  let parts: Part[] = [], flash = 0, flashPt: Pt = { x: CX, y: CY }, gatherPt: Pt = { x: CX, y: CY };
  let phaseT = 0;
  const SCATTER_T = 30, GATHER_MAX = 220, HOLD_T = 20;

  function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }
  function burst(px: number, py: number) { // 着弾点で虹粒子が四方へ飛散＋閃光
    flash = 1; flashPt = { x: px, y: py };
    const targets = rainbowScatterTargets(W, H, PAD, 28, rng);
    for (let i = 0; i < targets.length; i++) {
      const ddx = targets[i].x - px, ddy = targets[i].y - py, dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1, v0 = dd * (0.045 + rnd(0.035));
      parts.push({ x: px, y: py, vx: (ddx / dd) * v0, vy: (ddy / dd) * v0, life: 1, r: 2 + rnd(3), col: R[rnd(6) | 0],
        ph: rnd(6.2832), pv: 0.16 + rnd(0.16), amp: 0.8 + rnd(1.4), ease: 0.035 + rnd(0.05), startDelay: rnd(34) });
    }
  }
  function pickGatherFromParts(): Pt { // 集結先＝飛散粒子のうちの1つの位置（画面内クランプ）
    if (parts.length) { const p = parts[rnd(parts.length) | 0]; return { x: clamp(p.x, PAD, W - PAD), y: clamp(p.y, PAD, H - PAD) }; }
    return { x: PAD + rnd(W - 2 * PAD), y: PAD + rnd(H - 2 * PAD) };
  }
  function fireFrom(gx: number, gy: number) { origin = { x: gx, y: gy }; target = { x: CX, y: CY }; beamProg = 0; beamFade = 0; state = "beam"; }

  function drawBeam(o: Pt, tp: Pt, tipFrac: number, alpha: number) {
    const tx = o.x + (tp.x - o.x) * tipFrac, ty = o.y + (tp.y - o.y) * tipFrac;
    const g = ctx.createLinearGradient(o.x, o.y, tx, ty);
    for (let i = 0; i < R.length; i++) g.addColorStop(i / (R.length - 1), R[i]);
    ctx.globalAlpha = alpha; ctx.strokeStyle = g; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,255,255,0.7)"; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.shadowBlur = 0;
    const hg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 9);
    hg.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(2)})`); hg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function updateParts() {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const gathering = (state === "gather" && phaseT >= p.startDelay) || state === "charge";
      if (gathering) { // 集結点へイージング＋進行方向に垂直へゆらゆら（近づくほど収束）
        const dx = gatherPt.x - p.x, dy = gatherPt.y - p.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
        p.x += dx * p.ease; p.y += dy * p.ease;
        p.ph += p.pv;
        const sway = Math.sin(p.ph) * p.amp * Math.min(1, dl / 45);
        p.x += (-dy / dl) * sway; p.y += (dx / dl) * sway;
        p.life -= 0.0025;
      } else { p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life -= 0.003; }
      if (p.life <= 0) parts.splice(i, 1);
    }
  }
  function drawParts() {
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i]; ctx.globalAlpha = Math.min(1, m.life) * 0.95;
      ctx.fillStyle = m.col; ctx.shadowColor = m.col; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = Math.min(1, m.life); ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.4, 0, 6.2832); ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  function countWithin(r: number) { let n = 0; const rr = r * r; for (let i = 0; i < parts.length; i++) { const dx = parts[i].x - gatherPt.x, dy = parts[i].y - gatherPt.y; if (dx * dx + dy * dy < rr) n++; } return n; }
  function drawEnergyBall() {
    const n = countWithin(22); let grow = rainbowChargeGrow(n); if (grow <= 0) return;
    let inner = Math.min(1, 0.45 + n * 0.03); let cx = gatherPt.x, cy = gatherPt.y;
    if (state === "charge") { const ramp = phaseT / HOLD_T; grow *= 1 + 0.2 * Math.sin(phaseT * 0.8) + ramp * 0.25; inner = Math.min(1, inner + 0.25); const sh = ramp * 1.8; cx += (rnd(2) - 1) * sh; cy += (rnd(2) - 1) * sh; }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, grow);
    g.addColorStop(0, `rgba(255,255,255,${inner.toFixed(2)})`); g.addColorStop(0.5, `rgba(255,220,255,${(inner * 0.55).toFixed(2)})`); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, grow, 0, 6.2832); ctx.fill();
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    if (flash > 0.03) { const fr = 8 + (1 - flash) * 36, fg = ctx.createRadialGradient(flashPt.x, flashPt.y, 0, flashPt.x, flashPt.y, fr); fg.addColorStop(0, `rgba(255,255,255,${(flash * 0.85).toFixed(2)})`); fg.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(flashPt.x, flashPt.y, fr, 0, 6.2832); ctx.fill(); }
    drawParts();
    if (state === "gather" || state === "charge") drawEnergyBall();
    if (state === "beam") drawBeam(origin, target, beamProg, 1);
    else if (beamFade > 0.03) drawBeam(origin, target, 1, beamFade);
  }
  function step() {
    if (flash > 0) flash *= 0.82;
    if (beamFade > 0) beamFade *= 0.72;
    if (state === "beam") { beamProg += BEAM_SPEED; if (beamProg >= 1) { beamProg = 1; beamFade = 1; burst(target.x, target.y); state = "scatter"; phaseT = 0; } }
    else if (state === "scatter") { phaseT++; if (phaseT >= SCATTER_T) { gatherPt = pickGatherFromParts(); state = "gather"; phaseT = 0; } }
    else if (state === "gather") { phaseT++; if ((parts.length > 0 && countWithin(8) >= parts.length) || phaseT >= GATHER_MAX) { state = "charge"; phaseT = 0; } }
    else if (state === "charge") { phaseT++; if (phaseT >= HOLD_T) { flash = 1; flashPt = { x: gatherPt.x, y: gatherPt.y }; parts.length = 0; fireFrom(gatherPt.x, gatherPt.y); } }
    updateParts();
  }
  function frame(ts: number) { if (!last) last = ts; acc += ts - last; last = ts; while (acc >= 33) { step(); acc -= 33; } render(); raf = requestAnimationFrame(frame); }
  function runLoop() { if (raf == null) { last = 0; acc = 0; raf = requestAnimationFrame(frame); } }
  function reset() { parts = []; flash = 0; beamProg = 0; beamFade = 0; phaseT = 0; }
  function drawStatic() { // reduce＝中央に静的な虹の輝き（放射する6色の短い光条）
    ctx.clearRect(0, 0, W, H); ctx.save(); ctx.lineWidth = 3; ctx.lineCap = "round";
    for (let c = 0; c < R.length; c++) { const a = (c / R.length) * 6.2832; ctx.globalAlpha = 0.85; ctx.strokeStyle = R[c]; ctx.beginPath(); ctx.moveTo(CX + Math.cos(a) * 6, CY + Math.sin(a) * 6); ctx.lineTo(CX + Math.cos(a) * 20, CY + Math.sin(a) * 20); ctx.stroke(); }
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, 10); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, 10, 0, 6.2832); ctx.fill(); ctx.restore();
  }

  return {
    canvas,
    start(ox?: number, oy?: number) {
      // origin は枠相対 CSS px（0..PWpx/PHpx）で渡る＝マージン offset を足して canvas 座標へ。既定は枠の右上（術者位置）。
      reset();
      origin = { x: ox == null ? W - 6 : M + ox, y: oy == null ? M : M + oy };
      target = { x: CX, y: CY };
      state = "beam"; beamProg = 0; render(); runLoop();
    },
    startPersist() {
      // 履歴＝発射なしで放浪サイクル途中（中央着弾直後の飛散）から持続。以後 gather→charge→中央再ビーム…を続ける。
      reset();
      burst(CX, CY); state = "scatter"; phaseT = 0; render(); runLoop();
    },
    resume() { if (raf == null && state !== "idle" && state !== "static") { last = 0; acc = 0; raf = requestAnimationFrame(frame); } },
    reduceStatic() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } reset(); state = "static"; drawStatic(); },
    stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } },
  };
}
