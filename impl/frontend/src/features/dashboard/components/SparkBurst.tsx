"use client";

// クリック位置に一瞬だけ出る火花バースト（ゲーム感・クイック投票の手応え）。
// 楽観削除でカードが即消えても見えるよう、画面固定オーバーレイに座標指定で出す（カード非依存）。
// 生成/破棄は親が管理（reduce-motion 時は親が生成しない）。純粋な視覚（aria-hidden）。
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
