"use client";

import { useEffect, useRef } from "react";

import { genPath, mulberry32, pickLearnSeed, planLearn, LEARN_BOUNCES, type LearnPoint } from "@/features/spells/learnFx";
import { reduceMotion } from "@/lib/motion";

import type { CastRect } from "./SpellCastFx";

// 魔法解放の共通「習得」演出（SC-32・GF-AC-110）。受入済みモック（doc/画面設計/mocks/style-guide.html §17L-i）を移植。
// 全魔法共通（属性非依存）。解放クリックで ①説明パネル（カード）が暗転 → ②❓ アイコンがパネル中央へ移動 →
// ③魔法陣→円周の実線→光の円柱に包まれた❓のぐらぐら揺れ→溜め→解放でアイコン開封（❓→本来アイコン）→
// ④取得したアイコンが元の位置（ヘッダー）へ戻りパネル明転。座標固定オーバーレイ（カード全体＋余白を覆う canvas）。
// 決定的部分（魔法陣の頂点列/seed 選択/reduce 分岐）は learnFx.ts（G-TC-162）。reduce-motion 時は演出なしで即 onDone。

const GOLD = "250,200,80";
const PURP = "150,95,230";
const VEIL = "24,16,46"; // 説明パネルの暗転色（深い菫紺）
const FLAT = 0.5; // 床パース＝円の縦つぶし率
const GND_DY = 8; // 床の魔法陣の中心を少し下へ
const LW_GLOW = 3;
const LW_BODY = 1.4;
const LW_CORE = 0.7;
const R = 46; // 魔法陣の半径
const TL = 3800; // 内部タイムライン(ms)。move-in→ritual→move-out
const DUR = 5200; // 全体の再生時間（大きいほどゆっくり）
const MS = 40; // canvas 左右マージン
const MT = 130; // canvas 上マージン（光の円柱・「習得！」が上へはみ出す）
const MB = 20; // canvas 下マージン
const MOVE_IN = 420; // ❓ がパネル中央へ移動
const MOVE_OUT_START = 3300; // 取得アイコンが定位置へ戻り始める
const MOVE_OUT_END = 3800;

type Props = { cardRect: CastRect; iconRect: CastRect; icon: string; seed?: number; onDone?: () => void };

export function SpellLearnFx({ cardRect, iconRect, icon, seed, onDone }: Props) {
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

    const W = cardRect.width + MS * 2;
    const H = cardRect.height + MT + MB;
    const dpr = Math.min(2, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // canvas 座標での各位置
    const PHx = iconRect.left - cardRect.left + MS + iconRect.width / 2; // アイコンの定位置（ヘッダー）
    const PHy = iconRect.top - cardRect.top + MT + iconRect.height / 2;
    const PCx = MS + cardRect.width / 2; // パネル（カード）中央
    const PCy = MT + cardRect.height / 2;
    const cardBox = { x: MS, y: MT, w: cardRect.width, h: cardRect.height };
    const ipx = Math.max(20, Math.round(iconRect.height)); // アイコン実寸（受け渡しのサイズ一致）

    const chosen = seed ?? pickLearnSeed(Math.random());
    const path: LearnPoint[] = genPath(R, mulberry32(chosen));

    const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const ease = (x: number) => 1 - Math.pow(1 - x, 3); // easeOutCubic
    const back = (x: number) => {
      const s = 1.70158;
      return 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
    }; // easeOutBack
    const block = (x: number, y: number, s: number, col: string, a: number) => {
      if (a <= 0) return;
      ctx.fillStyle = "rgba(" + col + "," + a.toFixed(3) + ")";
      ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), Math.ceil(s), Math.ceil(s));
    };
    const rrect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const draw = (p: number) => {
      ctx.clearRect(0, 0, W, H);
      const t = p * TL;
      const mi = ease(clamp(t / MOVE_IN));
      const mo = ease(clamp((t - MOVE_OUT_START) / (MOVE_OUT_END - MOVE_OUT_START)));
      const rt = t - MOVE_IN; // 儀式内タイムライン
      const CX = PCx;
      const CY = PCy; // 儀式はパネル中央に描く
      // アイコン（❓/取得アイコン）の現在位置＝ヘッダー→中央→ヘッダー
      let IX: number;
      let IY: number;
      if (t < MOVE_IN) {
        IX = PHx + (PCx - PHx) * mi;
        IY = PHy + (PCy - PHy) * mi;
      } else if (t < MOVE_OUT_START) {
        IX = PCx;
        IY = PCy;
      } else {
        IX = PCx + (PHx - PCx) * mo;
        IY = PCy + (PHy - PCy) * mo;
      }
      // 説明パネル（カード）を暗転＝既存カード矩形を暗くする（新パネルは作らない）
      const panelDim = clamp(t / MOVE_IN) * (1 - mo);
      if (panelDim > 0.001) {
        ctx.save();
        ctx.fillStyle = "rgba(" + VEIL + "," + (0.62 * panelDim).toFixed(3) + ")";
        rrect(cardBox.x, cardBox.y, cardBox.w, cardBox.h, 12);
        ctx.fill();
        ctx.restore();
      }
      // 儀式の拍（rt 基準）
      const drawT = clamp((rt - 200) / 500);
      const perimT = clamp((rt - 700) / 900);
      const charge01 = clamp((rt - 840) / 1060);
      const chargeE = charge01 * charge01;
      const holdT = clamp((rt - 1900) / 140);
      const rel = clamp((rt - 2050) / 450);
      const fade = 1 - clamp((rt - 2100) / 450);
      const A0 = -1.5708;
      const grow = ease(clamp(rt / 220));
      const rr = R * grow;
      const rot = rt * 0.0009;
      const tension = Math.max(chargeE * 0.5, holdT) * (1 - rel);
      const GCX = CX + Math.sin(rt * 0.06) * tension * 1.6;
      const GCY = CY + GND_DY + Math.cos(rt * 0.055) * tension * 1.2;

      if (rt > 0 && fade > 0) {
        // 床の光だまり
        if (rr > 2) {
          const gg = ctx.createRadialGradient(GCX, GCY, 0, GCX, GCY, rr);
          gg.addColorStop(0, "rgba(" + GOLD + "," + ((0.1 + 0.28 * charge01) * fade).toFixed(3) + ")");
          gg.addColorStop(1, "rgba(" + GOLD + ",0)");
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.ellipse(GCX, GCY, rr, rr * FLAT, 0, 0, 6.2832);
          ctx.fill();
        }
        // 円周のガイド＝点線
        for (let i = 0; i < 30; i++) {
          const a = rot + (i / 30) * 6.2832;
          block(GCX + Math.cos(a) * rr, GCY + Math.sin(a) * rr * FLAT, 3, GOLD, (0.45 + 0.3 * charge01) * fade);
        }
        // 二重の同心円＋放射の刻印
        if (rr > 6) {
          const rot2 = -rt * 0.0018 * (0.32 + 0.7 * charge01);
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
        // 漂う光の塵
        const amb = clamp(rt / 1000) * fade * (1 - rel * 0.7);
        if (amb > 0) {
          for (let d = 0; d < 12; d++) {
            const da2 = (d / 12) * 6.2832 + rt * 0.0007 * (d % 2 ? 1 : -1);
            const dr = rr * (1.12 + 0.28 * ((d * 7) % 5) / 4);
            const dy2 = Math.sin(rt * 0.003 + d) * 3;
            block(GCX + Math.cos(da2) * dr, GCY + Math.sin(da2) * dr * FLAT + dy2 - 6, 1.5, d % 2 ? GOLD : PURP, 0.35 * amb * (0.55 + 0.45 * Math.sin(rt * 0.006 + d)));
          }
        }
        // 魔法陣の線（細め）
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
        // 円周（一筆書き・実線）
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
      }

      // 光の壁（発光）＋❓を包む：奥側の柱→❓→手前側の柱。❓/取得アイコンは IX,IY に描く。
      const beamGate = rt > 0 ? 1 - rel : 0;
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
          if (backSide ? sn > 0 : sn <= 0) continue;
          const sbx = GCX + Math.cos(sang) * rr;
          const sby = GCY + sn * rr * FLAT;
          const tpass = 700 + frac * 900;
          const riseAmt = ease(clamp((rt - tpass) / 320));
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
      drawWall(true);
      // ❓（未習得アイコン）＝IX,IY（move-in 中も表示）。円柱が出始めたら“ぐらぐら”揺れ、解放でフェードして取得アイコンへ。
      const qAlpha = 1 - clamp((rt - 2050) / 180);
      if (qAlpha > 0.01) {
        const wob = clamp((rt - 800) / 500) * (0.6 + 0.6 * charge01);
        const rotW = Math.sin(rt * 0.026) * 0.2 * wob;
        const dxW = Math.sin(rt * 0.041) * 3.5 * wob;
        const dyW = Math.cos(rt * 0.05) * 2.5 * wob;
        ctx.save();
        ctx.globalAlpha = qAlpha;
        ctx.translate(IX + dxW, IY + dyW);
        ctx.rotate(rotW);
        ctx.font = ipx + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("❓", 0, 0);
        ctx.restore();
      }
      drawWall(false);
      // 溜まったエネルギーの光球（中央の上）→解放で弾ける
      if (rt > 0) {
        const orbL = Math.max(charge01, holdT) * (1 - clamp(rel / 0.15));
        if (orbL > 0.02) {
          const oy = GCY - 30 - 12 * orbL;
          const orbR = 4 + 18 * orbL * (0.92 + 0.08 * Math.sin(rt * 0.01));
          const og = ctx.createRadialGradient(GCX, oy, 0, GCX, oy, orbR);
          og.addColorStop(0, "rgba(255,255,255," + (0.9 * orbL).toFixed(3) + ")");
          og.addColorStop(0.5, "rgba(" + GOLD + "," + (0.7 * orbL).toFixed(3) + ")");
          og.addColorStop(1, "rgba(" + GOLD + ",0)");
          ctx.fillStyle = og;
          ctx.beginPath();
          ctx.arc(GCX, oy, orbR, 0, 6.2832);
          ctx.fill();
        }
      }
      // ===== 解放（中央 PC で一気に） =====
      const flashT = clamp((rt - 2050) / 180);
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
      if (rel > 0 && rel < 1) {
        for (let q = 0; q < 24; q++) {
          const qang = (q / 24) * 6.2832 + 0.35;
          const qd = R * (0.3 + 1.7 * ease(rel));
          block(CX + Math.cos(qang) * qd, CY + Math.sin(qang) * qd, (1 - rel) * 3.5 + 1, q % 2 ? GOLD : PURP, (1 - rel) * fade);
        }
      }
      // 取得アイコン＝解放でポップ（中央）→ IX,IY に乗って move-out で定位置（ヘッダー）へ戻る→ HTML アイコンへ受け渡し。
      const li = clamp((rt - 2050) / 260);
      if (li > 0) {
        const sc = 0.4 + back(li) * 0.6;
        const yo = -12 * ease(li) * (1 - clamp(rel));
        const ia = Math.min(1, li * 2.5);
        ctx.save();
        ctx.globalAlpha = ia;
        const gr = 0.55 * (1 - rel * 0.5) * (1 - mo);
        if (gr > 0.001) {
          const g = ctx.createRadialGradient(IX, IY + yo, 0, IX, IY + yo, 34);
          g.addColorStop(0, "rgba(" + GOLD + "," + clamp(gr).toFixed(3) + ")");
          g.addColorStop(1, "rgba(" + GOLD + ",0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(IX, IY + yo, 34, 0, 6.2832);
          ctx.fill();
        }
        ctx.translate(IX, IY + yo);
        ctx.scale(sc, sc);
        ctx.font = ipx + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon, 0, 0);
        ctx.restore();
      }
      // 「✨ 習得！」＝中央のアイコンの上（解放後にポップ→move-out 前にフェード）
      const lt = clamp((rt - 2200) / 260);
      const labFade = 1 - clamp((t - 3050) / 250);
      if (lt > 0 && labFade > 0) {
        const lta = Math.min(1, lt * 2.2) * labFade;
        const lsc = 0.6 + back(clamp(lt * 1.3)) * 0.4;
        const ty = CY - R * 1.05 - 8 * ease(lt);
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
    // マウント時に一度だけ開始（cardRect/iconRect/icon/seed はマウント時の値で固定）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: "fixed", left: cardRect.left - MS, top: cardRect.top - MT, zIndex: 60, pointerEvents: "none" }}
    />
  );
}
