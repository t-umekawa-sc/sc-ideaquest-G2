"use client";

import { useEffect, useRef } from "react";

import { genPath, mulberry32, pickLearnSeed, planLearn, LEARN_BOUNCES, type LearnPoint } from "@/features/spells/learnFx";
import { reduceMotion } from "@/lib/motion";

import type { CastRect } from "./SpellCastFx";

// 魔法解放の共通「習得」演出（SC-32・GF-AC-110）。受入済みモック（doc/画面設計/mocks/style-guide.html §17L-i）を移植。
// 全魔法共通＝床の魔法陣→円周の実線→光の円柱に包まれた❓（ぐらぐら揺れ）→溜め→解放でアイコン開封（❓→本来アイコン）→余韻。
// 座標固定オーバーレイ（カードのアイコン矩形に重ねる）。決定的部分（魔法陣の頂点列/seed 選択/reduce 分岐）は learnFx.ts（G-TC-162）。
// reduce-motion 時は演出を出さず即 onDone（親が「解放済み」を表示）。生成/破棄は親（SpellsView）が管理。

const GOLD = "250,200,80";
const PURP = "150,95,230";
const VEIL = "24,16,46";
const FLAT = 0.5; // 床パース＝円の縦つぶし率
const GND_DY = 8; // 床の魔法陣の中心をアイコンより少し下へ
const LW_GLOW = 3;
const LW_BODY = 1.4;
const LW_CORE = 0.7;
const R = 46; // 魔法陣の半径（モックと一致）
const DUR = 4800; // 全体の再生時間（大きいほどゆっくり）。内部タイムラインは 3500ms 固定。
const HW = 110; // canvas 半幅（アイコン中心から左右）
const TOP = 150; // canvas の上マージン（魔法陣・光の柱・「習得！」が上へはみ出す）
const BOT = 70; // canvas の下マージン（床の楕円ぶん）

type Props = { iconRect: CastRect; icon: string; seed?: number; onDone?: () => void };

export function SpellLearnFx({ iconRect, icon, seed, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    // reduce-motion＝演出なしで即完了（親が「解放済み」を表示）。決定的分岐は learnFx.planLearn。
    if (planLearn(reduceMotion()) === "static") {
      doneRef.current?.();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      doneRef.current?.();
      return;
    }

    const W = HW * 2;
    const H = TOP + BOT;
    const CX = HW;
    const CY = TOP;
    const dpr = Math.min(2, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const chosen = seed ?? pickLearnSeed(Math.random());
    const path: LearnPoint[] = genPath(R, mulberry32(chosen));
    // ❓/開封アイコンの表示サイズは実カードのアイコン（.spell-card__icon）に合わせる＝終了時の HTML アイコンへの受け渡しでサイズが跳ねない。
    const iconPx = Math.max(20, Math.round(iconRect.height));

    const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const ease = (x: number) => 1 - Math.pow(1 - x, 3); // easeOutCubic
    const back = (x: number) => {
      const s = 1.70158;
      return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
    }; // easeOutBack（オーバーシュート）
    const block = (x: number, y: number, s: number, col: string, a: number) => {
      if (a <= 0) return;
      ctx.fillStyle = "rgba(" + col + "," + a.toFixed(3) + ")";
      ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), Math.ceil(s), Math.ceil(s));
    };

    const draw = (p: number) => {
      ctx.clearRect(0, 0, W, H);
      const t = p * 3500; // 内部タイムライン(ms)は固定。全体の速さは DUR で調整。
      // ---- 拍（緩急）：描く→溜まる(加速)→満タン張り詰め→一気に解放→余韻 ----
      const drawT = clamp((t - 200) / 500); // 内側の反射線を描く 200–700ms
      const charge01 = clamp((t - 840) / 1060); // エネルギーが溜まる 840–1900ms
      const chargeE = charge01 * charge01;
      const holdT = clamp((t - 1900) / 140); // 満タンの張り詰め 1900–2040ms
      const rel = clamp((t - 2050) / 450); // 解放 2050–2500ms
      const relE = ease(rel);
      const fade = 1 - clamp((t - 2100) / 450); // 魔法陣・床・塵が解放で消える
      const endFade = 1 - clamp((t - 3100) / 380); // 余韻の最後にアイコン＋「習得！」がフェード
      const after = clamp((t - 2400) / 350) * endFade; // 解放後の余韻
      const A0 = -1.5708;
      const perimT = clamp((t - 700) / 900); // 円周を最後に一筆書きする進捗 700–1600ms
      const grow = ease(clamp(t / 220));
      const rr = R * grow;
      const rot = p * 6.2832 * 0.5;
      // 満タン直前の張り詰め＝細かなふるえ（解放で消える）
      const tension = Math.max(chargeE * 0.5, holdT) * (1 - rel);
      const GCX = CX + Math.sin(t * 0.06) * tension * 1.6;
      const GCY = CY + GND_DY + Math.cos(t * 0.055) * tension * 1.2;

      // 神秘の闇のヴェール（縁ほど濃いヴィネット・解放で晴れる）
      const veilA = 0.6 * clamp(t / 440) * (1 - relE);
      if (veilA > 0.001) {
        const vg = ctx.createRadialGradient(CX, CY, R * 0.2, CX, CY, Math.max(W, H) * 0.6);
        vg.addColorStop(0, "rgba(" + VEIL + "," + (veilA * 0.35).toFixed(3) + ")");
        vg.addColorStop(0.55, "rgba(" + VEIL + "," + (veilA * 0.6).toFixed(3) + ")");
        vg.addColorStop(1, "rgba(" + VEIL + "," + veilA.toFixed(3) + ")");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }
      // 床の光だまり（エネルギーで増す）
      if (rr > 2) {
        const gg = ctx.createRadialGradient(GCX, GCY, 0, GCX, GCY, rr);
        gg.addColorStop(0, "rgba(" + GOLD + "," + ((0.1 + 0.28 * charge01) * fade).toFixed(3) + ")");
        gg.addColorStop(1, "rgba(" + GOLD + ",0)");
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.ellipse(GCX, GCY, rr, rr * FLAT, 0, 0, 6.2832);
        ctx.fill();
      }
      // 円周のガイド＝点線（最後に太い実線で塗りつぶす）
      for (let i = 0; i < 30; i++) {
        const a = rot + (i / 30) * 6.2832;
        block(GCX + Math.cos(a) * rr, GCY + Math.sin(a) * rr * FLAT, 3, GOLD, (0.45 + 0.3 * charge01) * fade);
      }
      // 二重の同心円＋放射の刻印（溜まるほど速く回る）
      if (rr > 6) {
        const rot2 = -p * 6.2832 * (0.32 + 0.7 * charge01);
        for (let j = 0; j < 18; j++) {
          const ja = rot2 + (j / 18) * 6.2832;
          block(GCX + Math.cos(ja) * rr * 0.6, GCY + Math.sin(ja) * rr * 0.6 * FLAT, 2, PURP, 0.55 * fade);
        }
        ctx.strokeStyle = "rgba(" + GOLD + "," + (0.3 * fade).toFixed(3) + ")";
        ctx.lineWidth = 1;
        for (let k = 0; k < 12; k++) {
          const ta = rot2 + (k / 12) * 6.2832;
          const r1 = rr * 1.02;
          const r2 = rr * 1.15;
          ctx.beginPath();
          ctx.moveTo(GCX + Math.cos(ta) * r1, GCY + Math.sin(ta) * r1 * FLAT);
          ctx.lineTo(GCX + Math.cos(ta) * r2, GCY + Math.sin(ta) * r2 * FLAT);
          ctx.stroke();
        }
      }
      // 漂う光の塵（アンビエント）
      const amb = clamp(p / 0.3) * fade * (1 - rel * 0.7);
      if (amb > 0) {
        for (let d = 0; d < 12; d++) {
          const da2 = (d / 12) * 6.2832 + p * 6.2832 * 0.12 * (d % 2 ? 1 : -1);
          const dr = rr * (1.12 + 0.28 * ((d * 7) % 5) / 4);
          const dy2 = Math.sin(p * 6.2832 * 0.5 + d) * 3;
          block(GCX + Math.cos(da2) * dr, GCY + Math.sin(da2) * dr * FLAT + dy2 - 6, 1.5, d % 2 ? GOLD : PURP, 0.35 * amb * (0.55 + 0.45 * Math.sin(p * 7 + d)));
        }
      }
      // 魔法陣の線（細め）。紫グロー→金の本体→白コア（溜まるほど白熱）
      if (drawT > 0) {
        const segF = drawT * LEARN_BOUNCES;
        const full = Math.floor(segF);
        const frac = segF - full;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const passes = [
          { col: PURP, w: LW_GLOW, a: 0.28 * fade },
          { col: GOLD, w: LW_BODY, a: 0.95 * fade },
          { col: "255,250,235", w: LW_CORE, a: (0.3 + 0.65 * charge01) * fade },
        ];
        let hx: number | null = null;
        let hy = 0;
        for (const pass of passes) {
          ctx.strokeStyle = "rgba(" + pass.col + "," + pass.a.toFixed(3) + ")";
          ctx.lineWidth = pass.w;
          ctx.shadowColor = "rgba(" + pass.col + ",0.85)";
          ctx.shadowBlur = pass.w * 3;
          ctx.beginPath();
          ctx.moveTo(GCX + path[0].x, GCY + path[0].y * FLAT);
          const lim = Math.min(full, LEARN_BOUNCES);
          for (let s = 1; s <= lim; s++) ctx.lineTo(GCX + path[s].x, GCY + path[s].y * FLAT);
          if (full < LEARN_BOUNCES && frac > 0) {
            const A = path[full];
            const B = path[full + 1];
            hx = A.x + (B.x - A.x) * frac;
            hy = A.y + (B.y - A.y) * frac;
            ctx.lineTo(GCX + hx, GCY + hy * FLAT);
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        const lim2 = Math.min(full, LEARN_BOUNCES);
        for (let v = 0; v <= lim2; v++) block(GCX + path[v].x, GCY + path[v].y * FLAT, 2.5, GOLD, 0.9 * fade);
        if (hx !== null) block(GCX + hx, GCY + hy * FLAT, 3.5, "255,255,255", 0.95 * fade);
      }
      // 円周（一筆書き）：金の実線（点線を塗りつぶす太さ）を A0 から perimT ぶん描き進める
      if (perimT > 0 && rr > 2) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(" + GOLD + "," + (0.95 * fade).toFixed(3) + ")";
        ctx.lineWidth = 3.6;
        ctx.shadowColor = "rgba(" + GOLD + ",0.8)";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.ellipse(GCX, GCY, rr, rr * FLAT, 0, A0, A0 + perimT * 6.2832);
        ctx.stroke();
        if (perimT < 1) {
          const pha = A0 + perimT * 6.2832;
          ctx.shadowBlur = 0;
          block(GCX + Math.cos(pha) * rr, GCY + Math.sin(pha) * rr * FLAT, 3, "255,255,255", 0.95 * fade);
        }
        ctx.restore();
      }
      // 光の壁（発光）＋❓を包む：奥側の柱→❓→手前側の柱 の順で描き、❓を光の円柱の内側に閉じ込める
      const beamGate = 1 - rel;
      const wallH = 70 * beamGate;
      const drawWall = (backSide: boolean) => {
        if (beamGate <= 0.01 || rr <= 6 || perimT <= 0) return;
        const DENS = 110;
        const M = Math.max(1, Math.round(DENS * perimT));
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let si = 0; si <= M; si++) {
          const frac = si / DENS;
          const sang = A0 + frac * 6.2832;
          const sn = Math.sin(sang);
          if (backSide ? sn > 0 : sn <= 0) continue; // 奥=sn<=0（上側・❓の後ろ）／手前=sn>0（下側・❓の前）
          const sbx = GCX + Math.cos(sang) * rr;
          const sby = GCY + sn * rr * FLAT;
          const tpass = 700 + frac * 900; // 実線がこの位置を通過した時刻(ms)
          const riseAmt = ease(clamp((t - tpass) / 320)); // 通過後 320ms かけて下→上へ伸びる
          if (riseAmt <= 0.001) continue;
          const colH = wallH * riseAmt;
          const lg = ctx.createLinearGradient(sbx, sby, sbx, sby - colH);
          lg.addColorStop(0, "rgba(" + GOLD + "," + (0.32 * beamGate).toFixed(3) + ")");
          lg.addColorStop(1, "rgba(" + GOLD + ",0)");
          ctx.fillStyle = lg;
          ctx.fillRect(sbx - 3.5, sby - colH, 7, colH);
        }
        ctx.restore();
      };
      drawWall(true); // 奥側の柱（❓の後ろ）
      // 未習得アイコン＝❓（光の円柱の中）。円柱が出始めたら“ぐらぐら”揺れ、習得の瞬間にフェードして本来のアイコンへ。
      const qAlpha = (1 - clamp((t - 2050) / 180)) * endFade;
      if (qAlpha > 0.01) {
        const wob = clamp((t - 800) / 500) * (0.6 + 0.6 * charge01);
        const rotW = Math.sin(t * 0.026) * 0.2 * wob;
        const dxW = Math.sin(t * 0.041) * 3.5 * wob;
        const dyW = Math.cos(t * 0.05) * 2.5 * wob;
        ctx.save();
        ctx.globalAlpha = qAlpha;
        ctx.translate(CX + dxW, CY + dyW);
        ctx.rotate(rotW);
        ctx.font = iconPx + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("❓", 0, 0);
        ctx.restore();
      }
      drawWall(false); // 手前側の柱（❓の前）＝❓が円柱に包まれる
      // 溜まったエネルギーの光球（中心の上に育つ）→解放で弾ける
      const orbL = Math.max(charge01, holdT) * (1 - clamp(rel / 0.15));
      if (orbL > 0.02) {
        const oy = GCY - 30 - 12 * orbL;
        const orbR = 4 + 18 * orbL * (0.92 + 0.08 * Math.sin(p * 36));
        const og = ctx.createRadialGradient(GCX, oy, 0, GCX, oy, orbR);
        og.addColorStop(0, "rgba(255,255,255," + (0.9 * orbL).toFixed(3) + ")");
        og.addColorStop(0.5, "rgba(" + GOLD + "," + (0.7 * orbL).toFixed(3) + ")");
        og.addColorStop(1, "rgba(" + GOLD + ",0)");
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(GCX, oy, orbR, 0, 6.2832);
        ctx.fill();
      }
      // ===== 解放：ここから一気に =====
      const flashT = clamp((t - 2050) / 180);
      if (flashT > 0 && flashT < 1) {
        const fa = Math.sin(flashT * Math.PI) * 0.9;
        const fg = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 2.1);
        fg.addColorStop(0, "rgba(255,255,255," + fa.toFixed(3) + ")");
        fg.addColorStop(0.6, "rgba(" + GOLD + "," + (fa * 0.5).toFixed(3) + ")");
        fg.addColorStop(1, "rgba(" + GOLD + ",0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(CX, CY, R * 2.1, 0, 6.2832);
        ctx.fill();
      }
      // 衝撃波リング（二重）
      if (rel > 0 && rel < 0.7) {
        const sw = ease(clamp(rel / 0.7));
        ctx.strokeStyle = "rgba(255,255,255," + ((1 - sw) * 0.9).toFixed(3) + ")";
        ctx.lineWidth = 4 * (1 - sw) + 1;
        ctx.beginPath();
        ctx.arc(CX, CY, R * (0.4 + 2.2 * sw), 0, 6.2832);
        ctx.stroke();
        ctx.strokeStyle = "rgba(" + GOLD + "," + ((1 - sw) * 0.7).toFixed(3) + ")";
        ctx.lineWidth = 3 * (1 - sw) + 1;
        ctx.beginPath();
        ctx.arc(CX, CY, R * (0.2 + 1.6 * sw), 0, 6.2832);
        ctx.stroke();
      }
      // 外へ弾けるきらめき（解放）
      if (rel > 0 && rel < 1) {
        for (let q = 0; q < 24; q++) {
          const qang = (q / 24) * 6.2832 + 0.35;
          const qd = R * (0.3 + 1.7 * ease(rel));
          block(CX + Math.cos(qang) * qd, CY + Math.sin(qang) * qd, (1 - rel) * 3.5 + 1, q % 2 ? GOLD : PURP, (1 - rel) * fade);
        }
      }
      // 余韻：解放後、アイコンのまわりをゆっくり漂うきらめき
      if (after > 0) {
        for (let w = 0; w < 8; w++) {
          const wa = (w / 8) * 6.2832 + t * 0.0009;
          const wph = (t * 0.0006 + w * 0.31) % 1;
          const wx = CX + Math.cos(wa) * (14 + 6 * Math.sin(w * 1.7));
          const wy = CY - 10 - wph * 30;
          block(wx, wy, (1 - wph) * 2 + 0.5, w % 2 ? GOLD : PURP, (1 - wph) * 0.5 * after);
        }
      }
      // アイコンが一気に飛び出す（解放でオーバーシュート）→余韻でふわっと浮遊→最後は定位置へ着地（HTML へ受け渡し）
      const settle = clamp((t - 2900) / 500);
      const li = clamp((t - 2050) / 260);
      if (li > 0) {
        const sc = 0.4 + back(li) * 0.6;
        const yo = (-12 * ease(li) + Math.sin(t * 0.004) * 1.5 * after) * (1 - settle);
        const ia = Math.min(1, li * 2.5);
        ctx.save();
        ctx.globalAlpha = ia;
        const gr = (0.6 * (1 - rel * 0.5) + 0.18 * after * (0.6 + 0.4 * Math.sin(t * 0.006))) * (1 - settle);
        if (gr > 0.001) {
          const g = ctx.createRadialGradient(CX, CY + yo, 0, CX, CY + yo, 34);
          g.addColorStop(0, "rgba(" + GOLD + "," + clamp(gr).toFixed(3) + ")");
          g.addColorStop(1, "rgba(" + GOLD + ",0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(CX, CY + yo, 34, 0, 6.2832);
          ctx.fill();
        }
        ctx.translate(CX, CY + yo);
        ctx.scale(sc, sc);
        ctx.font = iconPx + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon, 0, 0);
        ctx.restore();
      }
      // 「✨ 習得！」アイコンの上（解放後にポップ→余韻の間表示、最後にフェード）
      const lt = clamp((t - 2200) / 260);
      if (lt > 0) {
        const lta = Math.min(1, lt * 2.2) * endFade;
        const lsc = 0.6 + back(clamp(lt * 1.3)) * 0.4;
        const ty = CY - R * 1.05 - 8 * ease(lt) + Math.sin(t * 0.004) * 1.5 * after;
        ctx.save();
        ctx.globalAlpha = lta;
        ctx.translate(CX, ty);
        ctx.scale(lsc, lsc);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 15px system-ui, sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(60,40,10,0.55)";
        ctx.strokeText("✨ 習得！", 0, 0);
        ctx.fillStyle = "rgba(" + GOLD + ",1)";
        ctx.fillText("✨ 習得！", 0, 0);
        ctx.restore();
      }
    };

    let raf = 0;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      draw(p);
      if (p < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, W, H);
        doneRef.current?.();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // マウント時に一度だけ開始（iconRect/icon/seed はマウント時の値で固定）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const centerX = iconRect.left + iconRect.width / 2;
  const centerY = iconRect.top + iconRect.height / 2;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: "fixed", left: centerX - HW, top: centerY - TOP, zIndex: 60, pointerEvents: "none" }}
    />
  );
}
