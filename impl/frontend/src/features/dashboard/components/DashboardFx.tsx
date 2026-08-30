"use client";

// 投票の押下フィードバック（火花バースト＋「+N XP」フロート）を、DashboardView とは別 state で管理する。
// 狙い＝火花/フロートの時間差消去（650ms/1100ms の setState）で DashboardView を再描画させないこと。
// これにより投票カードの繰り上がり（framer-motion layout）が完了した後に、再描画起因で再計測されて
// カードが微妙に上下する（GF-AC-040 の再ゆれ）のを防ぐ。生成/破棄はここに閉じる。純装飾（aria-hidden）。
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { SparkBurst, XpFloat } from "@/components/ui";
import { reduceMotion } from "@/lib/motion";

export type DashboardFxHandle = {
  burst: (e: { clientX: number; clientY: number }) => void;
  xpFloat: (e: { clientX: number; clientY: number }, label: string) => void;
};

export const DashboardFx = forwardRef<DashboardFxHandle>(function DashboardFx(_props, ref) {
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [xpFloats, setXpFloats] = useState<{ id: number; x: number; y: number; label: string }[]>([]);
  const burstId = useRef(0);
  const xpFloatId = useRef(0);

  useImperativeHandle(ref, () => ({
    burst(e) {
      if (reduceMotion()) return;
      const id = ++burstId.current;
      setBursts((b) => [...b, { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 650);
    },
    xpFloat(e, label) {
      if (reduceMotion()) return;
      const id = ++xpFloatId.current;
      setXpFloats((f) => [...f, { id, x: e.clientX, y: e.clientY, label }]);
      setTimeout(() => setXpFloats((f) => f.filter((z) => z.id !== id)), 1100);
    },
  }), []);

  return (
    <>
      {bursts.map((b) => <SparkBurst key={b.id} x={b.x} y={b.y} />)}
      {xpFloats.map((f) => <XpFloat key={f.id} x={f.x} y={f.y} label={f.label} />)}
    </>
  );
});
