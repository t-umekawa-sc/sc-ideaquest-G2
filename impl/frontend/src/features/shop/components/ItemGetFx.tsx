"use client";

// 購入成立の瞬間の「アイテム入手」演出（SC-30・ゲーム感 #12）。購入したカード矩形に重ね、
// アイテムアイコンがポップ＋きらめき＋「◆ -N」のコイン消費フィードバックを one-shot で出す。
// 座標固定オーバーレイ（カード非依存）。生成/破棄は親が管理（reduce-motion 時は親が生成しない）。純視覚（aria-hidden）。
export type GetRect = { top: number; left: number; width: number; height: number };

export function ItemGetFx({ rect, icon, cost }: { rect: GetRect; icon: string; cost: number }) {
  return (
    <div className="item-get" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} aria-hidden>
      <span className="item-get__flash" />
      <span className="item-get__ring" />
      <span className="item-get__icon">{icon}</span>
      <span className="item-get__spark item-get__spark--0">✨</span>
      <span className="item-get__spark item-get__spark--1">✦</span>
      <span className="item-get__spark item-get__spark--2">✨</span>
      <span className="item-get__spark item-get__spark--3">✦</span>
      <span className="item-get__cost">◆ -{cost}</span>
    </div>
  );
}
