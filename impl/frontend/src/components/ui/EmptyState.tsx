// 空状態の演出（ゲーム感 #19）＝マスコット/絵文字＋一言で「寂しさ」を解消する共通部品（§4.1 components）。
// アイコンはゆるく上下に揺れる（mascot-bob）＝reduce-motion で静止。純視覚（情報は title/hint に残す）。
import type { ReactNode } from "react";

export function EmptyState({
  icon = "🗺️",
  title,
  hint,
}: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state__icon" aria-hidden>{icon}</div>
      <div className="empty-state__title">{title}</div>
      {hint && <div className="empty-state__hint">{hint}</div>}
    </div>
  );
}
