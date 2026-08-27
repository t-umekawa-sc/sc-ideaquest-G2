"use client";

// 数値のカウントアップ演出（ゲーム感）。マウント時は 0→value、以降は前値→value を easeOutCubic で補間。
// `prefers-reduced-motion: reduce` では即時反映（アクセシビリティ・演出は付けない）。純表示 span。
import { useEffect, useRef, useState } from "react";

/** カウントアップの1フレーム値（純関数・テスト可能）。progress t∈[0,1] を easeOutCubic で補間し四捨五入。 */
export function countUpFrame(from: number, to: number, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const eased = 1 - Math.pow(1 - clamped, 3); // easeOutCubic（終端で滑らかに減速）
  return Math.round(from + (to - from) * eased);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && !!window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function CountUp({
  value,
  durationMs = 700,
  className,
  format = (n: number) => n.toLocaleString(),
}: {
  value: number;
  durationMs?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  // 初期は 0 から開始＝マウント時に 0→value を「積み上がる」演出にする。
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    if (prefersReducedMotion()) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = (ts - start) / durationMs;
      setDisplay(countUpFrame(from, to, p));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span className={className}>{format(display)}</span>;
}
