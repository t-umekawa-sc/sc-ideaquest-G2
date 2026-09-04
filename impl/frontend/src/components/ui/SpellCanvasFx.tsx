"use client";

import { useBoxSize } from "@/features/spells/useBoxSize";
import { useSpellEngine } from "@/features/spells/useSpellEngine";
import type { CastPoint } from "./SpellDeliveryFx";

// canvas 魔法エフェクトの薄いラッパ（Phase E・GF-AC-091）。受入済みモック（style-guide.html §17）の
// 自己完結 canvas+rAF エンジンを、実寸測定（useBoxSize）＋ライフサイクル管理（useSpellEngine）で React に載せる。
// メッセージ枠に重ねる座標オーバーレイ（`.spell-fx__layer`・aria-hidden）。canvas は effect 側エンジンが
// imperative に注入し、rAF は可視時のみ・reduce-motion は静止1枚（詳細は useSpellEngine）。
// justCast=true（能動発動直後）は発射→着弾→永続を1回だけ再生し、false（履歴）は永続のみ。
export function SpellCanvasFx({
  effect,
  justCast = false,
  castFrom = null,
}: {
  effect: string;
  justCast?: boolean;
  castFrom?: CastPoint | null;
}) {
  const { ref, size } = useBoxSize<HTMLSpanElement>();
  useSpellEngine(ref, { effect, size, justCast, castFrom });
  return <span className="spell-fx__layer" ref={ref} aria-hidden />;
}
