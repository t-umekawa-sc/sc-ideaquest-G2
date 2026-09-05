"use client";

import { useBoxSize } from "@/features/spells/useBoxSize";
import { useSpellEngine } from "@/features/spells/useSpellEngine";
import type { CastPoint } from "./SpellDeliveryFx";

// canvas 魔法エフェクトの薄いラッパ（Phase E・GF-AC-091）。受入済みモック（style-guide.html §17）の
// 自己完結 canvas+rAF エンジンを、実寸測定（useBoxSize）＋ライフサイクル管理（useSpellEngine）で React に載せる。
// メッセージ枠に重ねる座標オーバーレイ（`.spell-fx__layer`・aria-hidden）。canvas は effect 側エンジンが
// imperative に注入し、rAF は可視時のみ・reduce-motion は静止1枚（詳細は useSpellEngine）。
// 発射→着弾→永続を「初回表示」で1回だけ再生（発射起点＝起点ポリシー: doc/画面設計/screens/SC-24_アイデアチャット.md）。
// justCast=true（ログインユーザが新規発動）は castFrom（ヘッダーのユーザーアバター）から、false（表示/履歴）は
// originSelector（メッセージ内の発動者アバターバッジ／自作自演は作成者アバター）から飛来。以後の再生成は永続のみ。
export function SpellCanvasFx({
  effect,
  justCast = false,
  castFrom = null,
  originSelector = null,
}: {
  effect: string;
  justCast?: boolean;
  castFrom?: CastPoint | null;
  originSelector?: string | null;
}) {
  const { ref, size } = useBoxSize<HTMLSpanElement>();
  useSpellEngine(ref, { effect, size, justCast, castFrom, originSelector });
  return <span className="spell-fx__layer" ref={ref} aria-hidden />;
}
