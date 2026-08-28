"use client";

// クリック位置から「+N XP」がふわっと上昇して消える獲得フィードバック（ゲーム感 #8）。横断利用（SC-01／SC-22）。
// 楽観削除で対象が即消えても見えるよう、画面固定オーバーレイに座標指定で出す（要素非依存）。
// 生成/破棄は親が管理（reduce-motion 時は親が生成しない）。純粋な視覚（aria-hidden）。CSS＝design-system.css .xp-float。
export function XpFloat({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div className="xp-float" style={{ left: x, top: y }} aria-hidden>
      <span className="xp-float__txt">{label}</span>
    </div>
  );
}
