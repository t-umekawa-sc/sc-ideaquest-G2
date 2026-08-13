"use client";

// 会社/クエストのカラー選択（デザイン標準・shared.css .swatches/.swatch）。
// プリセット10色から単一選択（radiogroup）。SC-91 会社作成・SC-92 会社詳細で共用。
import type { CSSProperties } from "react";

// プリセット10色（正＝mocks/SC-91_システム管理.html の swatches）。
export const SWATCH_PRESETS: { color: string; label: string }[] = [
  { color: "#2563EB", label: "ブルー" },
  { color: "#0D9488", label: "ティール" },
  { color: "#059669", label: "グリーン" },
  { color: "#7C3AED", label: "バイオレット" },
  { color: "#4F46E5", label: "インディゴ" },
  { color: "#D97706", label: "アンバー" },
  { color: "#E11D48", label: "ローズ" },
  { color: "#0891B2", label: "シアン" },
  { color: "#EA580C", label: "オレンジ" },
  { color: "#475569", label: "スレート" },
];

type Props = {
  value: string; // 選択中の色（#RRGGBB）
  onChange: (color: string) => void;
  ariaLabel?: string;
};

export function Swatches({ value, onChange, ariaLabel = "会社カラー" }: Props) {
  return (
    <div className="swatches" role="radiogroup" aria-label={ariaLabel}>
      {SWATCH_PRESETS.map((sw) => (
        <button
          key={sw.color}
          type="button"
          className="swatch"
          role="radio"
          aria-checked={value.toUpperCase() === sw.color}
          aria-label={sw.label}
          style={{ ["--sw" as string]: sw.color } as CSSProperties}
          onClick={() => onChange(sw.color)}
        />
      ))}
    </div>
  );
}
