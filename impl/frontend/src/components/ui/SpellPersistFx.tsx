"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { castEffect, firePillars, thunderBolts, thunderSparks, rainbowArcBands, auraMotes, iceCrackTree } from "@/features/spells/cast";

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

// 氷の永続＝薄いガラス板＋四隅からの伝播ヒビツリー＋割れる破片（凍結→ヒビ→割れ→再凍結ループ）。
// ヒビの直線は枠の実アスペクト比に依存するため、枠を実測(ResizeObserver)して iceCrackTree(w,h) で生成する。
function IcePersist() {
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
  const segs = size ? iceCrackTree(size.w, size.h) : [];
  return (
    <span className="spell-fx__ice-clip" ref={ref} aria-hidden>
      <span className="spell-fx__ice-panel" />
      {segs.map((s, i) => (
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
  );
}

// Phase D: 属性別の永続エフェクト（モック §17 buildPersist→production）。魔法が着地したメッセージ枠に重ねる。
// 枠の基調グロー/ボーダーは message の `.spell-fx spell-fx--{effect}` クラスが担い、本コンポーネントは
// その上に属性ごとのリッチな装飾（炎＝火柱／…）を注入する。座標オーバーレイ（aria-hidden・純視覚）。
// 幾何は純ロジック（cast.ts）で決定的に組み立て vitest で担保。reduce-motion は CSS で animation 無効（静的）。
// 属性は増分で追加中（現状＝炎。雷/虹/オーラ/氷ツリーは後続の D 増分）。
export function SpellPersistFx({ effect }: { effect: string }) {
  const eff = castEffect(effect);
  if (eff === "fire") {
    return (
      <span className="spell-fx__pillars" aria-hidden>
        <span className="spell-fx__pbase" />
        {firePillars().map((p, i) => (
          <span
            key={i}
            className="spell-fx__peak"
            style={{ left: `${p.left}%`, "--h": `${p.h}px`, "--d": `${p.delay}s`, "--dur": `${p.dur}s` } as CSSProperties}
          />
        ))}
      </span>
    );
  }
  if (eff === "thunder") {
    // 落ちる稲妻＋弾ける電気スパーク（枠の基調ストロボは spell-fx--thunder クラスが担う）。
    return (
      <span className="spell-fx__thunder" aria-hidden>
        {thunderBolts().map((b, i) => (
          <svg key={i} className="spell-fx__bolt" viewBox="0 0 24 70" style={{ left: `${b.left}%`, "--rot": `${b.rot}deg`, animationDelay: `${b.delay}s` } as CSSProperties} aria-hidden>
            <polyline points="13,0 5,26 15,30 3,70" />
          </svg>
        ))}
        {thunderSparks().map((s, i) => (
          <span key={i} className="spell-fx__espark" style={{ left: `${s.left}%`, top: `${s.top}px`, animationDelay: `${s.delay}s` } as CSSProperties} />
        ))}
      </span>
    );
  }
  if (eff === "rainbow") {
    // 上辺の上に架かる全幅アーク（右→左へ clip ワイプで現れる）。枠の色相回転は spell-fx--rainbow クラスが担う。
    return (
      <svg className="spell-fx__arc" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden>
        {rainbowArcBands().map((b, i) => (
          <path key={i} d={b.d} stroke={b.color} />
        ))}
      </svg>
    );
  }
  if (eff === "aura") {
    // 「活力を送るバフ」＝内側の呼吸発光＋外周の太陽フレア＋輪郭の波動×3＋中央から放射する活力の粒。
    return (
      <span className="spell-fx__aura" aria-hidden>
        <span className="spell-fx__aura-breath" />
        <span className="spell-fx__aura-flare" />
        {AURA_WAVE_DELAYS.map((d, i) => (
          <span key={i} className="spell-fx__aura-wave" style={{ "--d": `${d}s` } as CSSProperties} />
        ))}
        {auraMotes().map((m, i) => (
          <span
            key={i}
            className="spell-fx__aura-mote"
            style={{ "--dx": `${m.dx}px`, "--dy": `${m.dy}px`, "--d": `${m.delay}s`, "--dur": `${m.dur}s` } as CSSProperties}
          />
        ))}
      </span>
    );
  }
  if (eff === "ice") {
    return <IcePersist />;
  }
  return null;
}
