"use client";

import { useEffect, useRef } from "react";
import { reduceMotion } from "@/lib/motion";
import { engineFor } from "./engines";
import type { CastPoint } from "@/components/ui/SpellDeliveryFx";

// canvas 魔法エンジンのライフサイクル管理（Phase E・GF-AC-091）。受入済みモックの canvas+rAF エンジンを
// React で安全に動かす薄い配線。要件＝(a) マウント時のみ生成/開始・アンマウントで stop＋canvas 除去、
// (b) 画面外は IntersectionObserver で rAF 停止・再可視で resume（state 保持＝発射からやり直さない）、
// (c) reduce-motion は reduceStatic()（rAF 不要の静止1枚）、(d) dpr/実寸連動、(e) OS reduce の後付け ON を
// matchMedia change で静止へ落とす安全弁。発射元＝メッセージ内の発動者アバターバッジ（originSelector）を canvas 相対 origin に変換して start に渡す。

type Params = {
  effect: string;
  size: { w: number; h: number } | null;
  // 発射元＝メッセージ内の発動者アバターバッジ（自作自演は作成者アバター）の CSS セレクタ。①新規発動も②表示も同じ
  // ＝canvas 枠内で完結（起点ポリシー: doc/画面設計/screens/SC-24_アイデアチャット.md）。取得不能時はエンジン既定（枠の右上）。
  originSelector?: string | null;
};

// 画面座標 from を canvas 内の (w,h) 単位へ変換。
function originFromScreen(canvas: HTMLCanvasElement, from: CastPoint | null | undefined, size: { w: number; h: number }) {
  if (!from) return null;
  const cr = canvas.getBoundingClientRect();
  if (!cr.width || !cr.height) return null;
  return { x: ((from.x - cr.left) / cr.width) * size.w, y: ((from.y - cr.top) / cr.height) * size.h };
}

export function useSpellEngine(ref: React.RefObject<HTMLElement | null>, params: Params) {
  const { effect, size } = params;
  const originSelectorRef = useRef(params.originSelector);
  originSelectorRef.current = params.originSelector;
  // 一度でも開始したら以後の再生成（実寸/dpr 変化）は永続のみ＝発射は二度と再生しない。
  const everStartedRef = useRef(false);

  useEffect(() => {
    const container = ref.current;
    if (!container || !size) return;
    const factory = engineFor(effect);
    if (!factory) return;

    const dpr = Math.min(2, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1);
    const engine = factory({ w: size.w, h: size.h, dpr });
    container.appendChild(engine.canvas);

    // reduce-motion＝静止1枚（rAF/IO なし）。
    if (reduceMotion()) {
      engine.reduceStatic();
      return () => {
        engine.stop();
        if (engine.canvas.parentNode === container) container.removeChild(engine.canvas);
      };
    }

    const startInitial = () => {
      if (everStartedRef.current) {
        // 実寸/dpr 変化での再生成＝発射は再生せず永続のみ（発射は「初回表示」で1回だけ）。
        engine.startPersist();
        return;
      }
      everStartedRef.current = true;
      // 発射元＝メッセージ内の発動者アバターバッジ（自作自演は作成者アバター）。①②とも同じ＝canvas 枠内で完結。
      const host = (container.closest?.(".msg") as HTMLElement | null) ?? container;
      const sel = originSelectorRef.current;
      const el = sel ? (host.querySelector(sel) as HTMLElement | null) : null;
      let o: { x: number; y: number } | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) o = originFromScreen(engine.canvas, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, size);
      }
      engine.start(o?.x, o?.y); // 取得不能ならエンジン既定（枠の右上＝発動者位置）
    };

    let started = false;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          const e = entries[0];
          if (!e) return;
          if (e.isIntersecting) {
            if (!started) { started = true; startInitial(); }
            else engine.resume();
          } else {
            engine.stop();
          }
        },
        { threshold: 0.01 },
      );
      io.observe(container);
    } else {
      // IO 非対応（SSR/jsdom）＝即開始。
      started = true;
      startInitial();
    }

    // OS reduce を後から ON にしたケース＝静止へ落とす安全弁。
    const mq = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : null;
    const onMq = () => { if (mq?.matches) { engine.reduceStatic(); } };
    mq?.addEventListener?.("change", onMq);

    return () => {
      io?.disconnect();
      mq?.removeEventListener?.("change", onMq);
      engine.stop();
      if (engine.canvas.parentNode === container) container.removeChild(engine.canvas);
    };
    // 実寸/dpr（size）・effect 変化で再生成。originSelector は ref 経由なので依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect, size?.w, size?.h]);
}
