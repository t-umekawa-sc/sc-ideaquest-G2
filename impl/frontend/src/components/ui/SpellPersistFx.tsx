"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { castEffect, firePillars, thunderBolts, thunderSparks, rainbowArcBands, auraMotes, iceCrackTree } from "@/features/spells/cast";

// Phase D: 属性別の永続エフェクト（モック §17 buildPersist→production）。魔法が着地したメッセージ枠に重ねる。
// 枠の基調グロー/ボーダーは message の `.spell-fx spell-fx--{effect}` クラスが担い、本コンポーネントは
// その上に属性ごとのリッチな装飾を注入する。座標オーバーレイ（aria-hidden・純視覚）。
// パネル依存の効果（炎の火柱本数・オーラ粒の分散・氷ヒビツリー）は実寸で変わるため、枠を実測(ResizeObserver)して
// 純ロジック（cast.ts）に w,h を渡し size-adaptive に生成する（実測前は mock 相当の 340×150 で暫定描画）。
// 幾何は決定的で vitest 担保。reduce-motion は CSS で animation 無効（静的）。

// オーラの波動＝3枚を等間隔にずらして連続波に（box-shadow spread が角丸輪郭に沿って外へ）。
const AURA_WAVE_DELAYS = [0, -1.13, -2.26];

// 氷が割れて飛ぶ破片（left/top/w/h(%)・clip・飛散 tx/ty/rot）。枠サイズ非依存の固定レイアウト。
const ICE_SHARDS = [
  { l: 0, t: 0, w: 56, h: 60, clip: "polygon(0 0,100% 0,0 100%)", tx: -44, ty: -31, rot: -46 },
  { l: 46, t: 0, w: 54, h: 56, clip: "polygon(100% 0,100% 100%,0 0)", tx: 44, ty: -27, rot: 44 },
  { l: 22, t: 28, w: 52, h: 72, clip: "polygon(0 0,100% 30%,50% 100%)", tx: -7, ty: 42, rot: -22 },
  { l: 0, t: 46, w: 54, h: 54, clip: "polygon(0 100%,0 0,100% 100%)", tx: -41, ty: 37, rot: 36 },
  { l: 52, t: 46, w: 48, h: 54, clip: "polygon(100% 100%,100% 0,0 100%)", tx: 44, ty: 41, rot: -40 },
];

// 枠（メッセージ）の実寸を測る。実測できるまで null。
function useBoxSize() {
  const ref = useRef<HTMLSpanElement>(null);
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

export function SpellPersistFx({ effect }: { effect: string }) {
  const eff = castEffect(effect);
  const { ref, size } = useBoxSize();
  const w = size?.w ?? 340;
  const h = size?.h ?? 150;
  return (
    <span className="spell-fx__layer" ref={ref} aria-hidden>
      {eff === "fire" && (
        <span className="spell-fx__pillars">
          <span className="spell-fx__pbase" />
          {firePillars(w).map((p, i) => (
            <span
              key={i}
              className="spell-fx__peak"
              style={{ left: `${p.left}%`, "--h": `${p.h}px`, "--d": `${p.delay}s`, "--dur": `${p.dur}s` } as CSSProperties}
            />
          ))}
        </span>
      )}
      {eff === "thunder" && (
        <span className="spell-fx__thunder">
          {thunderBolts().map((b, i) => (
            <svg key={i} className="spell-fx__bolt" viewBox="0 0 24 70" style={{ left: `${b.left}%`, "--rot": `${b.rot}deg`, animationDelay: `${b.delay}s` } as CSSProperties} aria-hidden>
              <polyline points="13,0 5,26 15,30 3,70" />
            </svg>
          ))}
          {thunderSparks().map((s, i) => (
            <span key={i} className="spell-fx__espark" style={{ left: `${s.left}%`, top: `${s.top}px`, animationDelay: `${s.delay}s` } as CSSProperties} />
          ))}
        </span>
      )}
      {eff === "rainbow" && (
        <svg className="spell-fx__arc" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden>
          {rainbowArcBands().map((b, i) => (
            <path key={i} d={b.d} stroke={b.color} />
          ))}
        </svg>
      )}
      {eff === "aura" && (
        <span className="spell-fx__aura">
          <span className="spell-fx__aura-breath" />
          <span className="spell-fx__aura-flare" />
          {AURA_WAVE_DELAYS.map((d, i) => (
            <span key={i} className="spell-fx__aura-wave" style={{ "--d": `${d}s` } as CSSProperties} />
          ))}
          {auraMotes(w, h).map((m, i) => (
            <span
              key={i}
              className="spell-fx__aura-mote"
              style={{ left: `${m.startX}%`, top: `${m.startY}%`, "--dx": `${m.dx}px`, "--dy": `${m.dy}px`, "--d": `${m.delay}s`, "--dur": `${m.dur}s` } as CSSProperties}
            />
          ))}
        </span>
      )}
      {eff === "ice" && (
        <span className="spell-fx__ice-clip">
          <span className="spell-fx__ice-panel" />
          {iceCrackTree(w, h).map((s, i) => (
            <span
              key={i}
              className={`spell-fx__crack ${s.tier}`}
              style={{ left: `${s.leftPct}%`, top: `${s.topPct}%`, width: `${s.len}px`, "--a": `${s.angle}deg` } as CSSProperties}
            />
          ))}
          {ICE_SHARDS.map((p, i) => (
            <span
              key={`s${i}`}
              className="spell-fx__ishard"
              style={{ left: `${p.l}%`, top: `${p.t}%`, width: `${p.w}%`, height: `${p.h}%`, clipPath: p.clip, "--tx": `${p.tx}px`, "--ty": `${p.ty}px`, "--rot": `${p.rot}deg` } as CSSProperties}
            />
          ))}
        </span>
      )}
    </span>
  );
}
