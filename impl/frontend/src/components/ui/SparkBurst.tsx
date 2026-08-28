"use client";

// クリック位置に一瞬だけ出る火花バースト（ゲーム感・投票の手応え）。横断利用（SC-01 クイック投票／SC-22 投票）。
// 楽観削除で対象が即消えても見えるよう、画面固定オーバーレイに座標指定で出す（要素非依存）。
// 生成/破棄は親が管理（reduce-motion 時は親が生成しない）。純粋な視覚（aria-hidden）。CSS＝design-system.css .spark-burst。
const SPARKS = [0, 1, 2, 3, 4, 5];

export function SparkBurst({ x, y }: { x: number; y: number }) {
  return (
    <div className="spark-burst" style={{ left: x, top: y }} aria-hidden>
      {SPARKS.map((i) => (
        <span key={i} className={`spark spark--${i}`}>✦</span>
      ))}
    </div>
  );
}
