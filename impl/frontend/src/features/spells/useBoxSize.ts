"use client";

import { useEffect, useRef, useState } from "react";

// 枠（メッセージ等）の実寸を ResizeObserver で測る共通フック。実測できるまで null。
// SpellPersistFx（size-adaptive な永続レイアウト）と SpellCanvasFx（canvas 内部解像度）で共有（DRY）。
export function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}
