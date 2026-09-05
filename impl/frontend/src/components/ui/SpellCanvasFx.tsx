"use client";

import { useBoxSize } from "@/features/spells/useBoxSize";
import { useSpellEngine } from "@/features/spells/useSpellEngine";

// canvas 魔法エフェクトの薄いラッパ（Phase E・GF-AC-091）。受入済みモック（style-guide.html §17）の
// 自己完結 canvas+rAF エンジンを、実寸測定（useBoxSize）＋ライフサイクル管理（useSpellEngine）で React に載せる。
// メッセージ枠に重ねる座標オーバーレイ（`.spell-fx__layer`・aria-hidden）。canvas は effect 側エンジンが
// imperative に注入し、rAF は可視時のみ・reduce-motion は静止1枚（詳細は useSpellEngine）。
// 発射→着弾→永続を「初回表示」で1回だけ再生。発射起点＝originSelector（メッセージ内の発動者アバターバッジ／
// 自作自演は作成者アバター）＝①新規発動も②表示も同じ枠内飛行（起点ポリシー: doc/画面設計/screens/SC-24_アイデアチャット.md）。
export function SpellCanvasFx({
  effect,
  originSelector = null,
}: {
  effect: string;
  originSelector?: string | null;
}) {
  const { ref, size } = useBoxSize<HTMLSpanElement>();
  useSpellEngine(ref, { effect, size, originSelector });
  return <span className="spell-fx__layer" ref={ref} aria-hidden />;
}
